/*
 * Certificate Revocation List (CRL) integration module.
 * Addresses issue #421: CRL contract is separate but should be integrated.
 *
 * Provides a unified interface so that certificate validity checks always
 * consult the CRL, making revocations immediately visible during verification.
 *
 * Revocation is atomic across the main certificate contract and the CRL
 * contract. The certificate contract is the owning boundary: when a
 * certificate is revoked there, the CRL adapter is invoked in the same
 * operation and any failure is rolled back, so the two stores cannot
 * diverge.
 */

export interface RevocationEntry {
  certId: string;
  revokedAt: number; // Unix timestamp
  reason: string;
}

/**
 * Event emitted whenever a revocation is added to the CRL.
 * This is the on-chain signal that off-chain indexers and the backend
 * webhook system consume to trigger certificate status updates.
 */
export interface CRLRevocationAddedEvent {
  /** Event topic name used for on-chain filtering and off-chain dispatch. */
  topic: 'CRLRevocationAddedEvent';
  /** The revoked certificate identifier. */
  certId: string;
  /** Unix timestamp at which the revocation was recorded. */
  revokedAt: number;
  /** Human-readable revocation reason. */
  reason: string;
}

export type CRLRevocationListener = (event: CRLRevocationAddedEvent) => void;

/**
 * Status of a certificate in the main certificate contract.
 */
export type CertificateStatus = 'Active' | 'Revoked';

/**
 * Minimal interface the CRL integration needs from the main certificate
 * contract. This is the owning boundary for certificate status.
 */
export interface CertificateStatusStore {
  getStatus(certId: string): CertificateStatus | undefined;
  setStatus(certId: string, status: CertificateStatus): void;
}

export class CertificateRevocationList {
  private revoked = new Map<string, RevocationEntry>();
  private readonly listeners = new Set<CRLRevocationListener>();

  /**
   * Subscribe to `CRLRevocationAddedEvent` emissions. Returns an unsubscribe function.
   */
  onEvent(listener: CRLRevocationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Revoke a certificate. In production this would write to the Soroban contract.
   *
   * Emits a `CRLRevocationAddedEvent` after the revocation is stored so that
   * off-chain indexers and the backend webhook system are notified.
   */
  revoke(certId: string, reason: string): void {
    if (this.revoked.has(certId)) {
      throw new Error(`Certificate ${certId} is already revoked.`);
    }
    const entry: RevocationEntry = {
      certId,
      revokedAt: Math.floor(Date.now() / 1000),
      reason,
    };
    this.revoked.set(certId, entry);
    this.emitRevocationAdded(entry);
  }

  /**
   * Check whether a certificate has been revoked.
   */
  isRevoked(certId: string): boolean {
    return this.revoked.has(certId);
  }

  /**
   * Retrieve the revocation entry for a certificate, if any.
   */
  getEntry(certId: string): RevocationEntry | undefined {
    return this.revoked.get(certId);
  }

  /**
   * Returns all revoked certificate IDs.
   */
  listRevoked(): string[] {
    return Array.from(this.revoked.keys());
  }

  /**
   * Removes a revocation entry. Used only for rollback when a cross-contract
   * revocation fails after the CRL write succeeded.
   */
  remove(certId: string): void {
    this.revoked.delete(certId);
  }

  private emitRevocationAdded(entry: RevocationEntry): void {
    const event: CRLRevocationAddedEvent = {
      topic: 'CRLRevocationAddedEvent',
      certId: entry.certId,
      revokedAt: entry.revokedAt,
      reason: entry.reason,
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener failures must not prevent the revocation from being recorded.
      }
    }
  }
}

/**
 * Revokes a certificate atomically in both the main certificate contract and the
 * CRL. This is the single entry point that issuers and tooling must use so the
 * two stores cannot diverge.
 *
 * Order of operations:
 *  1. Validate the certificate exists and is not already revoked in either store.
 *  2. Write the CRL revocation.
 *  3. Write the main contract status.
 *  4. If step 3 fails, roll back the CRL write so the certificate is not
 *     considered revoked anywhere.
 */
export function revokeCertificateAtomically(
  certId: string,
  reason: string,
  crt: CertificateRevocationList,
  statusStore: CertificateStatusStore,
): RevocationEntry {
  const currentStatus = statusStore.getStatus(certId);
  if (currentStatus === undefined) {
    throw new Error(`Certificate ${certId} does not exist.`);
  }
  if (currentStatus === 'Revoked' || crl.isRevoked(certId)) {
    throw new Error(`Certificate ${certId} is already revoked.`);
  }

  // Step 1: record the revocation in the CRL.
  crl.revoke(certId, reason);

  // Step 2: update the main contract. Roll back the CRL on failure.
  try {
    statusStore.setStatus(certId, 'Revoked');
  } catch (error) {
    crl.remove(certId);
    throw error;
  }

  const entry = crl.getEntry(certId);
  if (!entry) {
    // Unreachable given the successful revoke above, but keep the invariant
    // explicit so callers always receive a valid entry.
    throw new Error(`CRL revocation for ${certId} was not recorded.`);
  }
  return entry;
}

/**
 * Integrated certificate validator that checks both expiry and CRL status.
 * Replaces the pattern of calling the certificate contract and CRL contract separately.
 */
export function isCertificateValid(
  certId: string,
  expiresAt: number,
  crl: CertificateRevocationList,
): boolean {
  if (crl.isRevoked(certId)) return false;
  const now = Math.floor(Date.now() / 1000);
  return now < expiresAt;
}
