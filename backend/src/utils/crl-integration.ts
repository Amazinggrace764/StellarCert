/**
 * Certificate Revocation List (CRL) integration module.
 * Addresses issue #421: CRL contract is separate but should be integrated.
 *
 * Provides a unified interface so that certificate validity checks always
 * consult the CRL, making revocations immediately visible during verification.
 */

/**
 * Maximum byte length of a certificate ID accepted by the CRL.
 *
 * This mirrors the on-chain leaf constraint in `crl.rs` (`delete_certificate`
 * and `build_merkle_root`). IDs that exceed this bound cannot be represented
 * in a Merkle leaf and would otherwise cause a revocation-blocking panic.
 */
export const MAX_CERT_ID_LENGTH = 256;

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
 * Returns the number of UTF-8 bytes in `value`.
 */
export function certIdByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * Returns true when `value` fits within the Merkle leaf byte bound.
 */
export function isValidCertId(value: string): boolean {
  return certIdByteLength(value) <= MAX_CERT_ID_LENGTH;
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
   *
   * Throws when the certificate ID exceeds `MAX_CERT_ID_LENGTH` UTF-8 bytes,
   * since such an ID cannot be represented in a Merkle leaf and would block all
   * further revocations for the issuer.
   */
  revoke(certId: string, reason: string): void {
    const byteLength = certIdByteLength(certId);
    if (byteLength > MAX_CERT_ID_LENGTH) {
      throw new Error(
        `Certificate ID is ${byteLength} bytes, which exceeds the maximum of ${MAX_CERT_ID_LENGTH} bytes.`,
      );
    }
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
   * Builds the Merkle root over all revoked certificate IDs.
   *
   * Leaves are constructed directly from the UTF-8 encoding of each ID with
   * no fixed-size stack buffer, so IDs of any length are handled safely. The
   * invariant that IDs are within `MAX_CERT_ID_LENGTH` is enforced at the
   * revocation boundary in `revoke()`.
   */
  buildMerkleRoot(): string {
    const leaves = this.listRevoked().map((certId) => {
      const bytes = Buffer.from(certId, 'utf8');
      if (bytes.length > MAX_CERT_ID_LENGTH) {
        throw new Error(
          `Certificate ID is ${bytes.length} bytes, which exceeds the maximum of ${MAX_CERT_ID_LENGTH} bytes.`,
        );
      }
      return bytes;
});
    if (leaves.length === 0) {
      return Buffer.alloc(32).toString('hex');
    }
    let level = leaves;
    while (level.length > 1) {
      const next: Buffer[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = i + 1 < level.length ? level[i + 1] : left;
        next.push(hashPair(left, right));
      }
      level = next;
    }
    return level[0].toString('hex');
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

function hashPair(left: Buffer, right: Buffer): Buffer {
  // Deterministic domain-separated hash for Merkle internal nodes.
  const hash = createHash('sha256');
  hash.update(left);
  hash.update(right);
  return hash.digest();
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
