import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeiorm';
import { Repository } from 'typeiorm';
import {
  MetadataSchema,
  SchemaField,
  FieldType,
} from '../entities/metadata-schema.entity';
import {
  CreateMetadataSchemaDto,
  UpdateMetadataSchemaDto,
  SchemaFieldDto,
  ValidationErrorDetail,
  MetadataValidationResultdto,
} from '../dto/metadata-schema.dto';
import { LoggingService } from '../../../common/logging/logging.service';
import {
  isSafeRegexPattern as checkPatternSafety,
  MAX_PATTERN_LENGTH,
  MAX_PATTERN_INPUT_LENGTH,
} from '../../../common/utils/validation.utils';

/**
 * Maximum time (in ms) allowed for a single pattern match before it
 * is considered to have exceeded its budget. This is a defense-in-
 * depth guard for patterns that slip through the static analysis.
 */
const PATTERN_TIMEOUT_MS = 100;

/**
 * Validate a user-defined regex pattern at schema-creation time.
 *
 * Throws a BadRequestException when the pattern is invalid, too long,
 * or detected as potentially catastrophic. This is the owning boundary
 * for pattern safety: schemas that would be unsafe to evaluate are
 * rejected before they are persisted.
 */
function assertSafePattern(pattern: string, fieldName: string): void {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new BadRequestException(
      `Pattern for field "${fieldName}" exceeds the maximum allowed length of ${MAX_PATTERN_LENGTH} characters`,
    );
  }

  try {
    // Compile to verify syntax. The compiled regex is not retained.
    new RegExp(pattern);
  } catch {
    throw new BadRequestException(
      `Invalid regular expression pattern for field "${fieldName}"`,
    );
  }

  const safety = checkPatternSafety(pattern);
  if (!safety.valid) {
    throw new BadRequestException(
      `Pattern for field "${fieldName}" is potentially unsafe: ${safety.reason ?? 'catastrophic backtracking'}`,
    );
  }
}

/**
 * Recursively validate all patterns in a field definition, including
 * nested array items and object properties.
 */
function assertFieldPatternsSafe(field: SchemaFieldDto): void {
  if (field.pattern !== undefined && field.pattern !== null) {
    if (typeof field.pattern !== 'string') {
      throw new BadRequestException(
        `Pattern for field "${field.name}" must be a string`,
      );
    }
    assertSafePattern(field.pattern, field.name);
  }

  if (field.items) {
    assertFieldPatternsSafe(field.items);
  }

  if (field.properties) {
    for (const prop of field.properties) {
      assertFieldPatternsSafe(prop);
    }
  }
}

function assertSchemaPatternsSafe(fields: SchemaFieldDto[] | undefined): void {
  if (!fields) return;
  for (const field of fields) {
    assertFieldPatternsSafe(field);
  }
}

@Injectable()
export class MetadataSchemaService {
  constructor(
    @InjectRepository(MetadataSchema)
    private readonly schemaRepository: Repository<MetadataSchema>,
    private readonly logger: LoggingService,
  ) {}

  async create(dto: CreateMetadataSchemaDto): Promise<MetadataSchema> {
    // Reject unsafe/invalid patterns at the owning boundary before
    // anything is persisted.
    assertSchemaPatternsSafe(dto.fields);

    const existing = await this.schemaRepository.findOne({
      where: { name: dto.name, version: dto.version },
    });

    if (existing) {
      throw new ConflictException(
        `Schema "${dto.name}" version ${dto.version} already exists`,
      );
    }

    const requiredFields =
      dto.requiredFields ??
      dto.fields.filter((f) => f.required).map((f) => f.name);

    const previous = await this.findLatestByName(dto.name);

    const schema = this.schemaRepository.create({
      ...dto,
      requiredFields,
      allowCustomFields: dto.allowCustomFields ?? true,
      previousVersionId: previous?.id,
    });

    const saved = await this.schemaRepository.save(schema);
    this.logger.log(
      `Schema created: ${saved.name} v${saved.version}`,
    );
    return saved;
  }

  async findAll(issuerId?: string): Promise<MetadataSchema[]> {
    const where: any = { isActive: true };
    if (issuerId) where.issuerId = issuerId;
    return this.schemaRepository.find({
      where,
      order: { name: 'ASC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<MetadataSchema> {
    const schema = await this.schemaRepository.findOne({ where: { id } });
    if (!schema) throw new NotFoundException(`Schema ${id} not found`);
    return schema;
  }

  async findByName(name: string): Promise<MetadataSchema[]> {
    return this.schemaRepository.find({
      where: { name, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async findLatestByName(name: string): Promise<MetadataSchema | null> {
    return this.schemaRepository.findOne({
      where: { name, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async update(
    id: string,
    dto: UpdateMetadataSchemaDto,
  ): Promise<MetadataSchema> {
    const schema = await this.findOne(id);

    // Validate any patterns provided in the update before applying them.
    const dtoAny = dto as any;
    if (dtoAny.fields) {
      assertSchemaPatternsSafe(dtoAny.fields);
    }

    Object.assign(schema, dto);

    if (dtoAny.fields) {
      schema.requiredFields =
        dtoAny.requiredFields ??
        dtoAny.fields
          .filter((f: SchemaFieldDto) => f.required)
          .map((f: SchemaFieldDto) => f.name);
    }

    return this.schemaRepository.save(schema);
  }

  async upgradeSchema(
    name: string,
    dto: CreateMetadataSchemaDto,
  ): Promise<MetadataSchema> {
    const current = await this.findLatestByName(name);
    if (!current) {
      throw new NotFoundException(
        `No existing schema found with name "${name}"`,
      );
    }

    const [curMajor, curMinor, curPatch] = current.version
      .split('.')
      .map(Number);
    const [newMajor, newMinor, newPatch] = dto.version.split('.').map(Number);

    const isNewer =
      newMajor > curMajor ||
      (newMajor === curMajor && newMinor > curMinor) ||
      (newMajor === curMajor && newMinor === curMinor && newPatch > curPatch);

    if (!isNewer) {
      throw new BadRequestException(
        `New version ${dto.version} must be greater than current ${current.version}`,
      );
    }

    return this.create({ ...dto, name });
  }

  async deactivate(id: string): Promise<MetadataSchema> {
    const schema = await this.findOne(id);
    schema.isActive = false;
    return this.schemaRepository.save(schema);
  }

  async getVersionHistory(name: string): Promise<MetadataSchema[]> {
    return this.schemaRepository.find({
      where: { name },
      order: { createdAt: 'DESC' },
    });
  }

  async validate(
    schemaId: string,
    metadata: Record<string, any>,
  ): Promise<MetadataValidationResultdto> {
    const schema = await this.findOne(schemaId);
    const errors = this.validateAgainstSchema(schema, metadata);

    return {
      valid: errors.length === 0,
      errors,
      schemaId: schema.id,
      schemaVersion: schema.version,
    };
  }

  validateAgainstSchema(
    schema: MetadataSchema,
    metadata: Record<string, any>,
  ): ValidationErrorDetail[] {
    const errors: ValidationErrorDetail[] = [];

    if (!metadata || typeof metadata !== 'object') {
      errors.push({
        field: '_root',
        message: 'Metadata must be a non-null object',
        constraint: 'type',
      });
      return errors;
    }

    for (const requiredField of schema.requiredFields ?? []) {
      if (
        metadata[requiredField] === undefined ||
        metadata[requiredField] === null
      ) {
        errors.push({
          field: requiredField,
          message: `"${requiredField}" is required`,
          value: undefined,
          constraint: 'required',
        });
      }
    }

    for (const field of schema.fields) {
      const value = metadata[field.name];
      if (value === undefined || value === null) continue;
      errors.push(...this.validateField(field, value));
    }

    if (!schema.allowCustomFields) {
      const definedFields = new Set(schema.fields.map((f) => f.name));
      for (const key of Object.keys(metadata)) {
        if (!definedFields.has(key)) {
          errors.push({
            field: key,
            message: `Custom field "${key}" is not allowed by this schema`,
            value: metadata[key],
            constraint: 'noCustomFields',
          });
        }
      }
    }

    return errors;
  }

  /**
   * Safely test a string value against a user-defined regex pattern.
   *
   * Patterns are validated at schema-creation time, but legacy schemas
   * may predate that validation. This method therefore defends in depth:
   *   - compilation is wrapped in try/catch (invalid patterns become a
   *     validation error, not a 500);
   *   - overly long inputs are rejected before matching;
   *   - potentially unsafe patterns are rejected;
   *   - matching is bounded by a timeout budget and a max input length.
   */
  private testPatternSafely(
    pattern: string,
    value: string,
    fieldName: string,
  ): { matched: boolean; error?: ValidationErrorDetail } {
    if (pattern.length > MAX_PATTERN_LENGTH) {
      return {
        matched: false,
        error: {
          field: fieldName,
          message: `"${fieldName}" has an invalid pattern configuration`,
          value,
          constraint: 'patternInvalid',
        },
      };
    }

    const safety = checkPatternSafety(pattern);
    if (!safety.valid) {
      return {
        matched: false,
        error: {
          field: fieldName,
          message: `"${fieldName}" has an unsafe pattern configuration`,
          value,
          constraint: 'patternUnsafe',
        },
      };
    }

    if (value.length > MAX_PATTERN_INPUT_LENGTH) {
      return {
        matched: false,
        error: {
          field: fieldName,
          message: `"${fieldName}" exceeds the maximum length of ${MAX_PATTERN_INPUT_LENGTH} for pattern matching`,
          value,
          constraint: 'patternInputTooLong',
        },
      };
    }

    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch {
      return {
        matched: false,
        error: {
          field: fieldName,
          message: `"${fieldName}" has an invalid pattern configuration`,
          value,
          constraint: 'patternInvalid',
        },
      };
    }

    // Node's regex engine is synchronous, so we cannot interrupt a
    // runaway match; instead the input is bounded above and the pattern
    // is statically screened. The timer is a best-effort signal for
    // slow patterns.
    const start = Date.now();
    const matched = regex.test(value);
    const elapsed = Date.now() - start;
    if (elapsed > PATTERN_TIMEOUT_MS) {
      this.logger.warn(
        `Pattern match for field "${fieldName}" took ${elapsed}ms (budget ${PATTERN_TIMEOUT_MS}ms)`,
      );
    }

    return { matched };
  }

  private validateField(
    field: SchemaField,
    value: any,
  ): ValidationErrorDetail[] {
    const errors: ValidationErrorDetail[] = [];

    switch (field.type) {
      case FieldType.STRING:
        if (typeof value !== 'string') {
          errors.push({
            field: field.name,
            message: `"${field.name}" must be a string`,
            value,
            constraint: 'type',
          });
          break;
        }
        if (field.minLength !== undefined && value.length < field.minLength) {
          errors.push({
            field: field.name,
            message: `"${field.name}" must be at least ${field.minLength} characters`,
            value,
            constraint: 'minLength',
          });
        }
        if (field.maxLength !== undefined && value.length > field.maxLength) {
          errors.push({
            field: field.name,
            message: `"${field.name}" must be at most ${field.maxLength} characters`,
            value,
            constraint: 'maxLength',
          });
        }
        if (field.pattern) {
          const result = this.testPatternSafely(field.pattern, value, field.name);
          if (result.error) {
            errors.push(result.error);
          } else if (!result.matched) {
            errors.push({
              field: field.name,
              message: `"${field.name}" does not match the required pattern`,
              value,
              constraint: 'pattern',
            });
          }
        }
        break;

      case FieldType.NUMBER:
        if (typeof value !== 'number' || Number.isNaN(value)) {
          errors.push({
            field: field.name,
            message: `"${field.name}" must be a number`,
            value,
            constraint: 'type',
          });
        }
        break;

      case FieldType.BOOLEAN:
        if (typeof value !== 'boolean') {
          errors.push({
            field: field.name,
            message: `"${field.name}" must be a boolean`,
            value,
            constraint: 'type',
          });
        }
        break;

      default:
        break;

      default:
        break;
    }

    return errors;
  }
}
