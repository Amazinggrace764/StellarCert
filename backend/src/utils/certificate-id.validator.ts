/**
 * Certificate ID validation utilities.
 * Addresses issue #420: Certificate ID collision possible with user-provided IDs.
 *
 * Enforces ID format rules: prefix with issuer address, enforce length limits,
 * and reject empty or suspiciously long strings.
 *
 * The maximum length is chosen to keep the namespaced ID (and thus the leaf
 * input for the CRL Merkle tree) well under the 256-byte buffer used by
 * `build_merkle_root` in `clr.rs`. This prevents the revocation DoS caused by over-long
 * certificate IDs panicking leaf construction.
 */

const CERT_ID_MIN_LENGTH = 8;
const CERT_ID_MAX_LENGTH = 128;
/**
 * Maximum length of the issuer prefix applied by `buildNamespacedCertId`.
 */
const ISSUER_PREFIX_MAX_LENGTH = 10;
/**
 * Maximum length of a namespaced certificate ID as stored on chain and fed into
 * the CRL Merkle tree. Must remain <= 256 bytes to fit the leaf buffer.
 */
const CERT_ID_FULL_MAX_LENGTH = ISSUER_PREFIX_MAX_LENGTH + 1 + CERT_ID_MAX_LENGTH;
const CERT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface CertIdValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates a raw certificate ID provided by the issuer.
 */
export function validateCertificateId(id: string): CertIdValidationResult {
  if (!id || id.trim().length === 0) {
    return { valid: false, reason: 'Certificate ID must not be empty.' };
  }

  if (id.length < CERT_ID_MIN_LENGTH) {
    return {
      valid: false,
      reason: `Certificate ID must be at least ${CERT_ID_MIN_LENGTH} characters.`,
    };
  }

  if (id.length > CERT_ID_MAX_LENGTH) {
    return {
      valid: false,
      reason: `Certificate ID must not exceed ${CERT_ID_MAX_LENGTH} characters.`,
    };
  }

  if (!CERT_ID_PATTERN.test(id)) {
    return {
      valid: false,
      reason:
        'Certificate ID may only contain alphanumeric characters, hyphens, and underscores.',
    };
  }

  return { valid: true };
}

/**
 * Validates a fully namespaced certificate ID (the value stored on chain and
 * used as the CRL Merkle leaf input). Rejects IDs that would exceed the
 * 256-byte leaf buffer used by `build_merkle_root`, preventing the revocation
 * DoS described in the issue.
 */
export function validateNamespacedCertId(id: string): CertIdValidationResult {
  if (!id || id.trim().length === 0) {
    return { valid: false, reason: 'Certificate ID must not be empty.' };
  }

  if (id.length > CERT_ID_FULL_MAX_LENGTH) {
    return {
      valid: false,
      reason: `Certificate ID must not exceed ${CERT_ID_FULL_MAX_LENGTH} characters once namespaced.`,
    };
  }

  return { valid: true };
}

/**
 * Builds a namespaced certificate ID by prefixing with the issuer's address.
 * This prevents cross-issuer collisions even when raw IDs are identical.
 */
export function buildNamespacedCertId(
  issuerAddress: string,
  rawId: string,
): string {
  const validation = validateCertificateId(rawId);
  if (!validation.valid) {
    throw new Error(`Invalid certificate ID: ${validation.reason}`);
  }
  // Truncate issuer address to first 10 chars for readability
  const prefix = issuerAddress
    .replace(/[^A-Za0-9]/g, '')
    .slice(0, ISSUER_PREFIX_MAX_LENGTH)
    .toUpperCase();
  const namespaced = `${prefix}_${rawId}`;

  // Defensive check: ensure the resulting ID fits the CRL leaf buffer.
  const fullValidation = validateNamespacedCertId(namespaced);
  if (!fullValidation.valid) {
    throw new Error(`Invalid certificate ID: ${fullValidation.reason}`);
  }

  return namespaced;
}
