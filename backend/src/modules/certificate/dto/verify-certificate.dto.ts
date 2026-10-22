import {
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsUUID,
  ValidateIf,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Ensures at least one of the certificate identifiers (code, tx hash,
 * or database UUID) is provided so the verification request is actionable.
 */
@injectable()
export class AtLeastOneIdentifierConstraint
  implements ValidatorConstraintInterface
{
  public validate(
    value: VerifyCertificateDto,
    args: { constraints?: unknown },
  ): boolean {
    const hasCode = typeof value.verificationCode === 'string' && value.verificationCode.trim().length > 0;
    const hasTxHash =
      typeof value.stellarTransactionHash === 'string' &&
      value.stellarTransactionHash.trim().length > 0;
    const hasId =
      typeof value.certificateId === 'string' && value.certificateId.trim().length > 0;
    return hasCode || hasTxHash || hasId;
  }

  public defaultMessage(args: { constraints?: unknown }): string {
    return 'At least one of verificationCode, stellarTransactionHash, or certificateId must be provided';
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
