import {
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsUUID,
  ValidatorConstraintInterface,
  ValidatorConstraint,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Custom constraint: at least one verification identifier must be provided.
 */
@ValidatorConstraint({ name: 'AtLeastOneVerificationIdentifier', async: false })
export class AtLeastOneVerificationIdentifier implements ValidatorConstraintInterface {
  validate(object: VerifyCertificateDto): boolean {
    return Boolean(object.verificationCode || object.stellarTransactionHash || object.certificateId);
  }

  defaultMessage(): string {
    return 'One of verificationCode, stellarTransactionHash, or certificateId must be provided';
  }
}

export class VerifyCertificateDto {
  @ApiPropertyOptional({
    description: 'Alphanumeric verification code printed on certificate',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  verificationCode?: string;

  @ApiPropertyOptional({ description: 'Stellar blockchain transaction hash' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  stellarTransactionHash?: string;

  @ApiPropertyOptional({ description: 'Certificate database UUID' })
  @IsOptional()
  @IsUUID()
  certificateId?: string;
}

export class VerificationQueryDto {
  @ApiPropertyOptional({
    description: 'Verifier identity (name or ID) for audit trail',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  verifiedBy?: string;
}
