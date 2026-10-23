import {
  IsString,
  IsEmail,
  IsOptional,
  IsUUID,
  IsEnum,
  IsBoolean,
  IsNumber,
  IsArray,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DuplicateCertificateDataDto {
  @ApiProperty({
    description: 'Issuer UUID used for duplicate detection',
    example: '5f1e8a8d-8f58-4c8b-88d4-5d0a8c9dbf2a',
  })
  @IsUUID()
  issuerId: string;

  @ApiProperty({
    description: 'Recipient email used to detect duplicates',
    example: 'recipient@example.com',
  })
  @IsEmail()
  recipientEmail: string;

  @ApiProperty({
    description: 'Recipient name used to detect duplicates',
    example: 'Jane Doe',
  })
  @IsString()
  recipientName: string;

  @ApiProperty({
    description: 'Certificate title used to detect duplicates',
    example: 'Introduction to Databases',
  })
  @IsString()
  title: string;

  @ApiPropertyOptional({
    description: 'Optional certificate description for duplicate evaluation',
    example: 'Completed the introductory database course.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Optional pre-generated certificate verification code',
    example: 'CERT-2026-001',
  })
  @IsOptional()
  @IsString()
  verificationCode?: string;

  @ApiPropertyOptional({
    description: 'Optional certificate expiration date',
    example: '2027-04-27T00:00:00Z',
  })
  @IsOptional()
  @Type(() => Date)
  expiresAt?: Date;

  @ApiPropertyOptional({
    description: 'Optional additional metadata used in duplicate checks',
    example: { program: 'Analytics' },
    type: Object,
  })
  @IsOptional()
  metadata?: Record<string, any>;
}

export class DuplicateCheckDto {
  @ApiProperty({
    description: 'Issuer UUID to check duplicates against',
    example: '5f1e8a8d-8f58-4c8b-88d4-5d0a8c9dbf2a',
  })
  @IsUUID()
  issuerId: string;

  @ApiProperty({
    description: 'Recipient email to check duplicates against',
    example: 'recipient@example.com',
  })
  @IsEmail()
  recipientEmail: string;

  @ApiProperty({
    description: 'Recipient name to check duplicates against',
    example: 'Jane Doe',
  })
  @IsString()
  recipientName: string;

  @ApiProperty({
    description: 'Certificate title to check duplicates against',
    example: 'Introduction to Databases',
  })
  @IsString()
  title: string;

  @ApiPropertyOptional({
    description: 'Optional description used during duplicate detection',
    example: 'Completed the introductory database course.',
  })
  @IsOptional()
  @IsString()
  description?: string;
}

export class DuplicateRuleDto {
  @ApiPropertyOptional({
    description: 'Optional duplicate rule ID',
    example: 'rule-1234',
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({
    description: 'Rule name',
    example: 'Exact title match',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Rule description',
    example: 'Reject certificates when title and recipient match exactly.',
  })
  @IsString()
  description: string;

  @ApiProperty({
    description: 'Whether this rule is active',
    example: true,
  })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    description: 'Action to take when duplicates are detected',
    enum: ['block', 'warn', 'allow'],
    example: 'warn',
  })
  @IsEnum(['block', 'warn', 'allow'])
  action: 'block' | 'warn' | 'allow';

  @ApiProperty({
    description: 'Matching threshold for duplicate scoring',
    example: 0.75,
  })
  @IsNumber()
  @Min(0)
  @Max(1)
  threshold: number;

  @ApiProperty({
    description: 'Fields to evaluate for duplicates',
    enum: ['recipientEmail', 'recipientName', 'title', 'issuerId'],
    example: ['recipientEmail', 'title'],
    type: [String],
  })
  @IsArray()
  @IsEnum(['recipientEmail', 'recipientName', 'title', 'issuerId'], {
    each: true,
  })
  checkFields: ('recipientEmail' | 'recipientName' | 'title' | 'issuerId')[];

  @ApiProperty({
    description: 'Whether fuzzy matching is enabled',
    example: false,
  })
  @IsBoolean()
  fuzzyMatching: boolean;

  @ApiPropertyOptional({
    description: 'Optional time window in days for duplicate checks',
    example: 30,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  timeWindow?: number;

  @ApiProperty({
    description: 'Rule priority for duplicate evaluation',
    example: 1,
  })
  @IsNumber()
  @Min(1)
  priority: number;
}

export class DuplicateDetectionConfigDto {
  @ApiProperty({
    description: 'Whether duplicate detection is enabled',
    example: true,
  })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    description: 'Default action when duplicates are found',
    enum: ['block', 'warn'],
    example: 'warn',
  })
  @IsEnum(['block', 'warn'])
  defaultAction: 'block' | 'warn';

  @ApiProperty({
    description: 'Duplicate detection rules',
    type: [DuplicateRuleDto],
  })
  @IsArray()
  rules: DuplicateRuleDto[];

  @ApiProperty({
    description: 'Whether manual override is allowed',
    example: true,
  })
  @IsBoolean()
  allowOverride: boolean;

  @ApiProperty({
    description: 'Whether admin approval is required for overrides',
    example: false,
  })
  @IsBoolean()
  requireAdminApproval: boolean;

  @ApiProperty({
    description: 'Whether duplicate findings are logged',
    example: true,
  })
  @IsBoolean()
  logDuplicates: boolean;
}

export class OverrideRequestDto {
  @ApiProperty({
    description: 'Certificate ID for override request',
    example: 'a3d8a582-bd23-4a2d-9630-6d4a2f5fd6f0',
  })
  @IsUUID()
  certificateId: string;

  @ApiProperty({
    description: 'Reason for requesting an override',
    example: 'Duplicate rule should not apply for this certificate',
  })
  @IsString()
  reason: string;

  @ApiProperty({
    description: 'User requesting the override',
    example: 'issuer@example.com',
  })
  @IsString()
  requestedBy: string;
}

export class ApproveOverrideDto {
  @ApiProperty({
    description: 'User approving the override',
    example: 'admin@example.com',
  })
  @IsString()
  approvedBy: string;
}
