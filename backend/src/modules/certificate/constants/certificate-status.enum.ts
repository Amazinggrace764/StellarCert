export enum CertificateStatus {
  ACTIVE = 'active',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
  PENDING = 'pending',
  FROZEN = 'frozen',
  SUPERSEDED = 'superseded',
}

/**
 * Statuses that permit metadata-only updates.
 *
 * A frozen certificate is still a valid, issuer-owned artifact; allowing
 * metadata corrections without an unfreeze/refreeze cycle avoids a
 * temporary window where the certificate is unfrozen.
 */
export const METADATA_UPDATABLE_STATUSES: readonly CertificateStatus[] = [
  CertificateStatus.ACTIVE,
  CertificateStatus.FROZEN,
];

export function isMetadataUpdatable(status: CertificateStatus): boolean {
  return METADATA_UPDATABLE_STATUSES.includes(status);
}
