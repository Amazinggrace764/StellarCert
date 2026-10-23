export * from './roles';
export * from './error-codes';

export const STELLAR_ADDRESS_REGEX= /^G[A-Z0-9]{55}$/;
export const STELLAR_TRANSACTION_HASH_REGEX = /^[a-f0-9]{64}$/;

export const API_PREFIX = 'api';
export const API_VERSION = 'v1';

export const REQUEST_TIMEOUT_MS = 30000; // 30 seconds
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const CERTIFICATE_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
};

export const ACCOUNT_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SUSPENDED: 'suspended',
};

// File upload constants
export const maxFileSize = 5 * 1024 * 1024; // 5MB
export const allowedImageMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

// Audit log constants
// The audit log table is queried, sorted and purged by the `bigint timestamp`
// column (e.g. `timestamp BETWEEN ...`, `ORDER BY ... timestamp DESC`,
// `timestamp <= cutoff`). The index must live on that column so those
// hot-path queries do not fall back to sequential scans/sorts.
// See `AuditLogEntity` for the corresponding `@Index(['timestamp'])` declaration.
export const AUDIT_LOG_TIMESTAMP_COLUMN = 'timestamp';
