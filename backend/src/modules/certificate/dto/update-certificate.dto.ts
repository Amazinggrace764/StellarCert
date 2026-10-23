import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateCertificateDto } from './create-certificate.dto';

/**
 * Payload for metadata-only corrections of a certificate.
 *
 * This DOT deliberately does not expose lifecycle fields such as `status`,
 * `issuedAt`, `expiresAt` or `serialNumber`. Those are owned by the
 * certificate lifecycle boundary (freeze / unfreeze / revoke) and must not be
 * mutable through a metadata update. By keeping this DOT metadata-only, the
 * service can safely allow corrections on frozen certificates without a
 * temporary unfreeze window.
 */
export class UpdateCertificateMetadataDto extends PartialType(CreateCertificateDto) {
  @ApiProperty({
    description:
      'Human-readable note recorded with the metadata correction. Optional.',
    required: false,
  })
  reason?: string;
}

/**
 * Backwards-compatible alias. Existing callers and generated clients that
 * import `UpdateCertificateDto` keep working; the service must reject
 * lifecycle fields at the boundary rather than relying on the DOT type.
 */
export class UpdateCertificateDto extends UpdateCertificateMetadataDto {}
