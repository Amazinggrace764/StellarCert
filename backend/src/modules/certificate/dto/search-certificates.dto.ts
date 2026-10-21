import {
  IsOptional,
  IsString,
  IsEmail,
  IsUUID,
  IsEnum,
  IsDateString,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CertificateStatus } from '../constants/certificate-status.enum';

export class SearchCertificatesDto {
  @ApiPropertyOptional({
    description: 'Filter by recipient email (partial match)',
  })
  @IsOptional()
  @IsEmail()
  recipientEmail?: string;

  @ApiPropertyOptional({
    description: 'Filter by recipient name (partial match)',
  })
  @IsOptional()
  @IsString()
  recipientName?: string;

  @ApiPropertyOptional({ description: 'Filter by issuer UUID' })
  @IsOptional()
  @IsUUID()
  issuerId?: string;

  @ApiPropertyOptional({
    description: 'Filter by certificate status',
    enum: CertificateStatus,
  })
  @IsOptional()
  @IsEnum(CertificateStatus)
  status?: CertificateStatus;

  @ApiPropertyOptional({ description: 'Filter by title (partial match)' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    description: 'Filter certificates issued on or after this date (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  issuedFrom?: string;

  @ApiPropertyOptional({
    description: 'Filter certificates issued on or before this date (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  issuedTo?: string;

  @ApiPropertyOptional({
    description: 'Filter certificates expiring after this date (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  expiresFrom?: string;

  @ApiPropertyOptional({
    description: 'Filter certificates expiring before this date (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  expiresTo?: string;

  @ApiPropertyOptional({
    description: 'Filter by human-readable certificate ID',
  })
  @IsOptional()
  @IsString()
  certificateId?: string;

  @ApiPropertyOptional({
    description: 'Filter certificates that have a Stellar transaction',
  })
  @IsOptional()
  hasStellarTransaction?: boolean;

  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Results per page', default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['issuedAt', 'expiresAt', 'title', 'recipientName'],
  })
  @IsOptional()
  @IsString()
  sortBy?: string = 'issuedAt';

  @ApiPropertyOptional({ description: 'Sort order', enum: ['ASC', 'DESC'] })
  @IsOptional()
  @IsString()
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}
