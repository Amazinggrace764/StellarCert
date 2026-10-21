/*
 * Certificate Revocation List (CRL) integration module.
 * Addresses issue #421: CRL contract is separate but should be integrated.
 *
 * Provides a unified interface so that certificate validity checks always
 * consult the CRL, making revocations immediately visible during verification.
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
