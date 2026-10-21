export * from './roles';
export * from './error-codes';

export const STELLAR_ADDRESS_REGEX_PATTERN = /^G[A-Z0-9]{55}$/;
export const STELLAR_TRANSACTION_HASH_REGEX_PATTERN = /^[a-f0-9]{64}$/;

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

// ------------------------------------------------------------------------------
// Soroban event indexer constants
// ------------------------------------------------------------------------------

/** Name of the durable cursor row managed in the indexer state table. */
export const INDEXER_CURSOR_ID: string = 'soroban-event-indexer';

/** Lowest ledger the indexer will ever attempt to index. */
export const INDEXER_MIN_LEDGER: number = 1;

/** How many ledgers must close before a ledger is considered final. */
export const INDEXER_FINALITY_CONFIRMATIONS: number = 5;

/** Maximum number of ledgers fetched per RPC call. */
export const INDEXER_MAX_LEDGER_BATCH_SIZE: number = 100;

/** Maximum number of events fetched per RPC call. */
export const INDEXER_MAX_EVENTS_PER_PAGE: number = 200;

/** Maximum ledger range allowed for a single operator-controlled replay. */
export const INDEXER_MAX_REPLAY_RANGE: number = 10000;

/** Maximum number of attempts for a transient failure before dead-lettering. */
export const INDEXER_MAX_RETRIES_PER_BLOCK = 8;

/** Base delay for exponential backoff between retries (ms). */
export const INDEXER_RETRY_BASE_DELAY_MS = 250;

/** Cap for exponential backoff between retries (ms). */
export const INDEXER_RETRY_MAX_DELAY_MS = 30_000;

/** How often the indexer polls for new ledgers when idle (ms). */
export const INDEXER_POLL_INTERVAL_MS = 2_000;

/** How often lag and health metrics are reported (ms). */
export const INDEXER_METRICS_INTERVAL_MS = 15_000;

/** How often reconciliation sweeps run (ms). */
export const INDEXER_RECONCILIATION_INTERVAL_MS = 60_000;

/** Maximum number of records reconciled per sweep. */
export const INDEXER_RECONCILIATION_BATCH_SIZE = 500;

/** How long a dead-lettered batch is retained before being pruned (days). */
export const INDEXER_DEAD_LETTER_RETENTION_DAYS = 30;

/** Typed identifiers for the indexer state machine. */
export const INDEXER_STATE_STATUS = {
  IDLE: 'idle',
  RUNNING: 'running',
  RETRYING: 'retrying',
  DEAD_LETTERED: 'dead_lettered',
  REPLAYING: 'replaying',
  RECONCILING: 'reconciling',
  STOPPED: 'stopped',
} as const;

export type IndexerStatus = (typeof INDEXER_STATE_STATUS)[keyof typeof INDEXER_STATE_STATUS];

/** Classification of event delivery outcomes for idlempotency and reconciliation. */
export const INDEXER_EVENT_DISPOSITION = {
  APPLIED: 'applied',
  DUPLICATE: 'duplicate',
  RECONCILED_MISMATCH: 'reconciled_mismatch',
  SKIPPED: 'skipped',
  FAILED: 'failed',
} as const;

export type IndexerEventDisposition =
  (typeof INDEXER_EVENT_DISPOSITION)[keyof typeof INDEXER_EVENT_DISPOSITION];

/** Reconciliation outcomes for database records whose on-chain outcome is missing or inconsistent. */
export const INDEXER_RECONCILIATION_RESULT = {
  CONSISTENT: 'consistent',
  MISSING_ON_CHAIN: 'missing_on_chain',
  CONFLICTING_ON_CHAIN: 'conflicting_on_chain',
  RECONCILED: 'reconciled',
  UNRESOLVED: 'unresolved',
} as const;

export type IndexerReconciliationResult =
  (typeof INDEXER_RECONCILIATION_RESULT)[keyof typeof INDEXER_RECONCILIATION_RESULT];
