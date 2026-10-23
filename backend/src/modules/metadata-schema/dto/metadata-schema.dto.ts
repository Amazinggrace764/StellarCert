import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsEnum,
  IsUUID,
  ValidateNested,
  IsNumber,
  Min,
  Matches,
  Validate,
  ValidationArguments,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { FieldType } from '../entities/metadata-schema.entity';

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require
const safeRegex = require('safe-regex');

// safe-regex exposes either a callable function or an object with `.regex`.
const isSafeRegex: (pattern: string) => boolean =
  typeof safeRegex === 'function'
    ? safeRegex
    : (pattern: string) => safeRegex.regex(pattern) === true;

const MAX_PATTERN_LENGTH = 512;

/**
 * Validates a user-supplied regular expression pattern at schema-creation time.
 *
 * Rejects patterns that:
 *  - are too long (bounds compilation/matching cost),
 *  - fail to compile (prevents uncaught SyntaxError -> 500 at match time),
 *  - are susceptible to catastrophic backtracking (ReDoS).
 */
function isSafeRegexPattern(pattern: string): boolean {
  if (typeof pattern !== 'string') {
    return false;
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return false;
  }
  try {
    // Ensure the pattern compiles.
    // eslint-disable-next-line no-new-regexp
    new RegExp(pattern);
  } catch {
    return false;
  }
  // safe-regex returns true when the pattern is considered safe.
  return isSafeRegex(pattern) === true;
}

export class SafeRegexConstraint {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (typeof value !== 'string') {
      return true; // let other constraints handle type validation
    }
    return isSafeRegexPattern(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} pattern must be a valid, bounded, ReDoS-safe regular expression (max ${MAX_PATTERN_LENGTH} characters)`;
  }
}

export class SchemaFieldDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ enum: FieldType })
  @IsEnum(FieldType)
  type: FieldType;

  @ApiProperty()
  @IsBoolean()
  required: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  minLength?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxLength?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  min?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  max?: number;

  @ApiPropertyOptional({
    description:
      'Regular expression pattern. Must compile, be bounded in length, and be ReDoS-safe.',
  })
  @IsOptional()
  @IsString()
  @Validate(SafeRegexConstraint)
  pattern?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enumValues?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  default?: any;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => SchemaFieldDto)
  items?: SchemaFieldDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SchemaFieldDto)
  properties?: SchemaFieldDto[];
}

export class CreateMetadataSchemaDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: '1.0.0' })
  @IsString()
  @Matches(/^\d+\.\d+\.\d+$/, {
    message: 'Version must follow semver format (e.g. 1.0.0)',
  })
  version: string;

  @ApiProperty({ type: [SchemaFieldDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SchemaFieldDto)
  fields: SchemaFieldDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredFields?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  allowCustomFields?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  issuerId?: string;
}

/**
 * Update payload for a metadata schema.
 *
 * The `identity key` of a schema is `(name, version)`. Mutating either of those
 * through an update would bypass the uniqueness guard enforced on create and would
 * corrupt the versioning invariant relied on by `findLatestByName` / `upgradeSchema`.
 *
 * Therefore `name` and `version` are deliberately excluded from the update DTN.
 * This is enforced at the boundary (DVO), so clients sending these fields get them
 * stripped by the global validation pipe (`whitelist: true`) and the service can no
 * longer accidentally collapse two records onto the same identity key.
 */
export class UpdateMetadataSchemaDto extends PartialType(
  OmitType(CreateMetadataSchemaDto, ['name', 'version'] as const),
) {}

export class ValidateMetadataDto {
  @ApiProperty()
  @IsUUID()
  schemaId: string;

  @ApiProperty()
  metadata: Record<string, any>;
}

export class ValidationErrorDetail {
  @ApiProperty()
  field: string;

  @ApiProperty()
  message: string;

  @ApiProperty()
  value?: any;

  @ApiProperty()
  constraint: string;
}

export class MetadataValidationResultDto {
  @ApiProperty()
  valid: boolean;

  @ApiProperty({ type: [ValidationErrorDetail] })
  errors: ValidationErrorDetail[];

  @ApiProperty()
  schemaId: string;

  @ApiProperty()
  schemaVersion: string;
}
