import {
  IsString,
  IsOptional,
  MaxLength,
  MinLength,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RevokeCertificateDto {
  @ApiProperty({ description: 'Reason for revoking the certificate' })
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason: string;

  @ApiPropertyOptional({
    description: 'Additional notes for the revocation audit trail',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    description: 'Record revocation as a Stellar transaction (default: true)',
  })
  @IsOptional()
  @IsBoolean()
  recordOnStellar?: boolean;
}
