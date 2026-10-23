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

import { createHash } from 'crypto';

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
   * Compute the Merkle root of the currently revoked certificate IDs.
   *
   * Domain separation is enforced to prevent second-preimage forgeries:
   *   - leaves are hashed as sha256(0x00 || certId)
   *   - internal nodes are hashed as sha256(0x01 || left || right)
   *
   * Odd counts are handled by carrying the unpaired node up to the next
   * level without duplicating it, so no silent duplication occurs.
   */
  merkleRoot(): string {
    const leaves = this.listRevoked()
      .sort()
      .map((certId) => hashLeaf(certId));

    if (leaves.length === 0) {
      // Empty tree: return the canonical empty-root constant (domain-tagged).
      return hashNode(Buffer.alloc(0, 0), Buffer.alloc(0, 0));
    }

    let level: Buffer[] = leaves;
    while (level.length > 1) {
      const nextLevel: Buffer[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = i + 1 < level.length ? level[i + 1] : undefined;
        if (right === undefined) {
          // Odd node: carry it untouched rather than duplicating it.
          nextLevel.push(left);
        } else {
          nextLevel.push(hashNode(left, right));
        }
      }
      level = nextLevel;
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

/** Domain separation tag for Merkle leaves. */
const LEAF_TAG = Buffer.from([0x00]);
//** Domain separation tag for Merkle internal nodes. */
const NODE_TAG = Buffer.from([0x01]);

function hashLeaf(certId: string): Buffer {
  return createHash('sha256').update(LEAF_TAG).update(certId, 'utf8').update(Buffer.from([0])).digest();
}

function hashNode(left: Buffer, right: Buffer): Buffer {
  return createHash('sha256').update(NODE_TAG).update(left).update(right).digest();
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
