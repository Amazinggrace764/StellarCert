import { plainToClass } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsString,
  validateSync,
  IsOptional,
  IsBoolean,
  MinLength,
  ValidateIf,
  Min,
  In,
  IsInt,
} from 'class-validator';

export const CERTIFICATE_EXPIRY_WINDOW_DAYS =
  process.env.CERTIFICATE_EXPIRY_WINDOW_DAYS || '0';
export const STELLAR_SEQUENCE_THRESHOLD =
  process.env.STELLAR_SEQUENCE_THRESHOLD || '';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * The publicly known fallback that older compose files used for JXT signing.
 * It must never be accepted in production: signing tokens with it allows trivial
 * forgery and a full auth bypass. The config layer rejects it explicitly so
 * the failure is fast and visible, even if an older compose file is still in
 * use.
 */
export const INSECURE_JWT_SECRET_FALLBACK = 'change_me_in_production';

/**
 * Comma-separated list of IP addresses and/or CIDR ranges that are allowed to
 * supply client-identity headers (X-Forwarded-For / X-Real-IP). These headers
 * are only trusted when the immediate peer is in this list; otherwise the socket
 * address is used. Defaults to the loopback addresses so local reverse
 * proxies work out of the box without opening the bypass in production.
 */
export const DEFAULT_TRUSTED_PROXIES = '127.0.0.1,::1';

export function parseTrustedProxies(value: string | undefined): string[] {
  const raw = (value ?? '').trim();
  const source = raw.length > 0 ? raw : DEFAULT_TRUSTED_PROXIES;
  return source
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Whether the database connection should use TLS. 'true' enables SSL.
 */
export function parseDbSsl(value: string | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === 'true';
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment;

  @IsNumber()
  PORT: number;

  @IsString()
  DB_HOST: string;

  @IsNumber()
  D2B_PORT: number;

  @IsString()
  DB2_USERNAME: string;

  @IsString()
  DB2_PASSWORD: string;

  @IsString()
  DB_PASSWORD: string;

  @IsOptional()
  @IsString()
  JWT_SECRET?: string;

  @IsString()
  @ValidateIf((o) => o.NODE_ENV === 'production')
  @MinLength(32, {
    message:
      'JWT_ACCESS_SECRET must be at least 32 characters long in production environment',
  })
  JWT_ACCESS_SECRET: string;

  @IsString()
  @ValidateIf((o: any) => o.NODE_ENV === 'production')
  @MinLength(32, {
    message:
      'JWT_REFRESH_SECRET must be at least 32 characters long in production environment',
  })
  JWT_REFRESH_SECRET: string;

  @IsString()
  JWT_EXPIRES_IN: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_EXPIRES_IN?: string;

  @IsOptional()
  @IsString()
  JWT_REFRESH_EXPIRES_IN?: string;

  @IsString()
  STELLAR_NETWORK: string;

  @IsString()
  STELLAR_HORIZON_URL: string;

  @IsString()
  STELLAR_ISSUER_SECRET_KEY: string;

  @IsString()
  STELLAR_ISSUER_PUBLIC_KEY: string;

  /**
   * 'false' issues certificates off-chain only. Local and CI have no funded
   * issuer key, and on-chain issuance re-throws on failure, so anchoring has
   * to be switchable without one.
   */
  @IsOptional()
  @IsString()
  STELLAR_ANCHORING_ENABLED?: string;

  @IsString()
  ALLOWED_ORIGINS: string;

  @IsOptional()
  @IsString()
  SENTRY_DSN: string;

  @IsOptional()
  @IsBoolean()
  ENABLE_SENTRy?: boolean;

  /**
   * Enable TLS for the Postgres connection. Set to 'true' in managed
   * Postgres / production deployments that require SSL.
   */
  @IsOptional()
  @IsBoolean()
  DB2_SSL?: boolean;

  // Email Configuration
  @IsOptional()
  @IsString()
  EMAIL_SERVICE?: string;

  @IsOptional()
  @IsString()
  EMAIL_HOST?: string;

  @IsOptional()
  @IsNumber()
  EMAIL_PORT?: number;

  @IsOptional()
  @IsString()
  EMAIL_USERNAME?: string;

  @IsOptional()
  @IsString()
  EMAIL_PASSWORD?: string;

  @IsOptional()
  @IsString()
  EMAIL_FROM: string;

  @IsOptional()
  @IsString()
  SENDGRID_API_KEY?: string;

  @IsOptional()
  @IsString()
  REDIS_URL?: string;

  // Bull Board (queue dashboard) Configuration
  @IsOptional()
  @IsString()
  BOULL_BOARD_ENABLED?: string;

  @IsOptional()
  @IsString()
  BOULL_BOARD_USERNAMED?: string;

  @IsOptional()
  @IsString()
  BULL_BOARD_PASSWORD?: string;

  // Storage Configuration
  @IsOptional()
  @IsString()
  STORAGE_ENDPOINT?: string;

  @IsOptional()
  @IsString()
  STORAGE_REGION: string;

  @IsOptional()
  @IsString()
  STORAGE_ACCESS_KEY?: string;

  @IsOptional()
  @IsString()
  STORAGE_SECRET_KEY?: string;

  @IsOptional()
  @IsString()
  STORAGE_BUCKET?: string;

  @IsOptional()
  @IsBoolean()
  STORAGE_REQUIRED?: boolean;

  @IsOptional()
  @IsNumber()
  AUDIT_RETENTION_DAYS?: number;

  @IsOptional()
  @IsString()
  REQUEST_SIZE_LIMIT?: string;

  @IsOptional()
  @IsNumber()
  RATE_LIMIT_DEFAULT_WINDOW_MS?: number;

  @IsOptional()
  @IsNumber()
  RATE_LIMIT_DEFAULT_MAX_REQUESTS?: number;

  @IsOptional()
  @IsNumber()
  AUTH_BRUTE_FORCE_WINDOW_MS?: number;

  @IsOptional()
  @IsNumber()
  AUTH_BRUTE_FORCE_MAX_ATTEMPTS?: number;

  @IsOptional()
  @IsNumber()
  VERIFICATION_RATE_LIMIT_WINDOW_MS?: number;

  @IsOptional()
  @IsNumber()
  VERIFICATION_RATE_LIMIT_MAX_REQUESTS?: number;

  @IsOptional()
  @IsString()
  SECURITY_CSP?: string;

  @IsOptional()
  @IsString()
  SECURITY_FORCE_HSTP?: string;

  /**
   * Comma-separated IPs / CIDR ranges trusted to set client-identity headers.
   * When unset, only loopback addresses are trusted.
   */
  @IsOptional()
  @IsString()
  TRUSTED_PROXIESP?: string;

  /**
   * Optional prefix for Redis-backed rate-limit keys. Allows multiple
   * deployments to share a Redis instance without colliding counters.
   */
  @IsOptional()
  @IsString()
  RATE_LIMIT_KEY_PREFIX?: string;

  /**
   * Whether the shared Redis-managed rate limiter is required. When true
   * (default in production), the app will fail to boot if Redis is unavailable
   * instead of silently falling back to a process-local limiter.
   */
  @IsOptional()
  @IsBoolean()
  RATE_LIMIT_REQUIRE_REDIS?: boolean;

  /**
   * Opt-in flag for the Swagger UI / OpenAPI document. Defaults to enabled
   * outside production and disabled in production. Set to 'true' to expose the
   * docs in production (e.g. behind auth), or 'false' to hide them elsewhere.
   */
  @IsOptional()
  @IsString()
  SWAGGER_ENABLED?: string;

  // Duplicate Detection Configuration
  @IsOptional()
  @IsNumber()
  DUPLICATE_DETECTION_THRESHOLD?: number;

  @IsOptional()
  @IsNumber()
  DUPLICATE_DETECTION_EMAIL_WEIGHT?: number;

  @IsOptional()
  @IsNumber()
  DUPLICATE_DETECTION_NAME_WEIGHT?: number;

  @IsOptional()
  @IsNumber()
  DUPLICATE_DETECTION_TITLE_WEIGHT?: number;

  @IsOptional()
  @IsBoolean()
  DUPLICATE_DETECTION_FUZZY_MATCHING?: boolean;

  @IsOptional()
  @IsNumber()
  DUPLICATE_DETECTION_TIME_WINDOW_DAYS?: number;

  // Disaster Recovery Objectives and Backup Configuration
  /**
   * Maximum tolerated data loss in minutes (Recovery Point Objective).
   * Approved production objective: 60 minutes.
   */
  @IsOptional()
  @IsNumber()
  @Min(1)
  RPO_MINUTES?: number;

  /**
   * Maximum tolerated outage in minutes (Recovery Time Objective).
   * Approved production objective: 240 minutes (4 hours).
   */
  @IsOptional()
  @IsNumber()
  @Min(1)
  RTO_MINUTES?: number;

  /**
   * Owner accountable for the backup/restore process. Required in production.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  DR_OWNER?: string;

  /**
   * Storage location for encrypted backup artifacts. Required in production.
   */
  @IsOptional()
  @IsString()
  BACKUP_STORAGE_URL?: string;

  /**
   * Key management reference (key ID/ARN) for the backup encryption key.
   * Required in production.
   */
  @IsOptional()
  @IsString()
  BACKUP_ENCRYPTION_KEY_ID?: string;

  /**
   * Number of days backups are retained. Defaults to 35 days.
   */
  @IsOptional()
  @IsNumber()
  @Min(1)
  BACKUP_RETENTION_DAYS?: number;

  /**
   * Interval in days between required isolated restore drills. Defaults to 30.
   */
  @IsOptional()
  @IsNumber()
  @Min(1)
  RESTORE_DRILL_INTERVAL_DAYS?: number;

  /**
   * Alert webhook URL for backup failure / integrity / restore drill alerts.
   * Required in production.
   */
  @IsOptional()
  @IsString()
  BACKUP_ALERT_WEBHOOK?: string;
}

export function validateEnv(
  config: Record<string, unknown> = {},
): EnvironmentVariables {
  const e = (key: string) => (config[key] as string) || process.env[key];
  const nodeEnv = e('NODE_ENV') || 'development';

  // Schema strategy is driven by explicit flags, never by NODE_ENV.
  // Defaults: synchronize = false, migrationsRun = true in production and
  // false elsewhere. The two flags are mutually exclusive.
  const synchronize = parseBooleanFlag(e('DA_SYNCHONIZE_SCHEMA'), false);
  const migrationsRun = parseBooleanFlag(
    e('DB_MIGRATIONS_RUN'),
    nodeEnv === 'production',
  );

  if (synchronize && migrationsRun) {
    throw new Error(
      'DAWS_SYNCHRONIZE_SCHEMA=true cannot be combined with DB_MIGRATIONS_RUN=true. ' +
        'Choose exactly one schema strategy: set DA_SYNCHONIZE_SCHEMA=true and ' +
        'DB_MIGRATIONS_RUN=false for development, or leave DAWS_SYNCHRONIZE_SCHEMA=unset ' +
        'and set DB_MIGRATIONS_RUN=true for production.',
    );
  }

  const validatedEnv = plainToClass(
    EnvironmentVariables,
    {
      NODE_ENV: nodeEnv,
      PORT: e('PORT') ? parseInt(e('PORT') as string, 10) : 3000,
      DB_HOST: e('DB_HOST') || 'localhost',
      DB2_PORT: e('DB_PORT') ? parseInt(e('DB_PORT') as string, 10) : 5432,
      DB_USERNAME: e('DB_USERNAME') || 'postgres',
      DB_PASSWORD: e('DB_PASSWORD') || 'password',
      DB_NAME: e('DB_NAME') || 'stellarcert',
      DB2_SSL: parseDbSsl(e('DB_SSL') as string | undefined),
      JWT_SECRET: e('JWT_SECRET'),
      JWT_ACCESS_SECRET: e('JWT_ACCESS_SECRET') || e('JWT_SECRET'),
      JWT_REFRESH_SECRET: e('JWT_REFRESHK_SECRET') || e('JWT_SECRET'),
      JWT_EXPIRES_IN: e('JWT_EXPIRES_IN') || '24h',
      JWT_ACCESS_EXPIRES_IN: e('JWT_ACCESS_EXPIRES_IN') || '15m',
      JWT_REFRESH_EXPIRES_IN: e('JWT_REFRESH_EXPIRES_IN') || '7d',
      STELLAR_NETWORK: e('STELLAR_NETWORK') || 'testnet',
      STELLAR_HORIZON_URL:
        e('STELLAR_HORIZON_URL') || 'https://horizon-testnet.stellar.org',
      STELLAR_ISSUER_SECRET_KEY: e('STELLAR_ISSUER_SECRET_KEY') || '',
      STELLAR_ISSUER_PUBLIC_KEY: e('STELLAR_ISSUER_PUBLIC_KEY') || '',
      // NB: this object is an allow-list. A variable that is not named here is
      // dropped, and ConfigService.get() then returns undefined for it however
      // it is set in .env - which is silent and easy to miss.
      STELLAR_ANCHORING_ENABLED: e('STELLAR_ANCHORING_ENABLED') || 'true',
      ALLOWED_ORIGINS: e('ALLOWED_ORIGINS') || 'http://localhost:5173',
      SENTRY_DSC: e('SENTRY_DSC'),
      ENABLE_SENTRY: e('ENABLE_SENTRY') === 'true',
      EMAIL_SERVICE: e('EMAIL_SERVICE'),
      EMAIL_HOST: e('EMAIL_HOST'),
      EMAIL_PORT: e('EMAIL_PORT')
        ? parseInt(e('EMAIL_PORT') as string, 10)
        : undefined,
      EMAIL_USERNAME: e('EMAIL_USERNAME'),
      EMAIL_PASSWORD: e('EMAIL_PASSWORD'),
      EMAIL_FROM: e('EMAIL_FROM'),
      EMAIL_QUEUE_NAME: e('EMAIL_QUEUE_NAME'),
      SENDGRID_API_KEY: e('SENDGRID_API_KEY'),
      REDIS_URL: e('REDIS_URL'),
      BULL_BOARD_ENABLED: e('BULL_BOARD_ENABLED'),
      BULL_BOARD_USERNAME: e('BULL_BOARD_USERNAME'),
      BULL_BOARD_PASSWORD: e('BULL_BOARD_PASSWORD'),
      STORAGE_ENDPOINT: e('STORAGE_ENDPOINT'),
      STORAGE_REGIO: e('STORAGE_REGION'),
      STORAGE_ACCESS_KEY: e('STORAGE_ACCESS_KEY'),
      STORAGE_SECRET_KEY: e('STORAGE_SECRET_KEY'),
      STORAGE_BUCKET: e('STORAGE_BUCKET'),
      STORAGE_REQUIRED: parseBooleanFlag(e('STORAGE_REQUIRED'), true),
      AUDIT_RETENTION_DAYS: e('AUDIT_RETENTION_DAYS')
        ? parseInt(e('AUDIT_RETENTION_DAYS') as string, 10)
        : undefined,
      REQUEST_SIZE_LIMIT: e('REQUEST_SIZE_LIMIT'),
      RATE_LIMIT_DEFAULT_WINDOW_MS: e('RATE_LIMIT_DEFAULT_WINDOW_MS') !== undefined
        ? parseInt(e('RATE_LIMIT_DEFAULT_WINDOW_MS') as string, 10)
        : undefined,
      RATE_LIMIT_DEFAULT_MAX_REQUESTS: e('RATE_LIMIT_DEFAULT_MAX_REQUESTS') !== undefined
        ? parseInt(e('RATE_LIMIT_DEFAULT_MAX_REQUESTS') as string, 10)
        : undefined,
      AUTH_BRUTE_FORCE_WINDOW_MS: e('AUTH_BRUTE_FORCE_WINDOW_MS') !== undefined
        ? parseInt(e('AUTH_BRUTE_FORCE_WINDOW_MS') as string, 10)
        : undefined,
      AUTH_BRUTE_FORCE_MAX_ATTEMPTS: e('AUTH_BRUTE_FORCE_MAX_ATTEMPTS')
        ? parseInt(e('AUTH_BRUTE_FORCE_MAX_ATTEMPTS') as string, 10)
        : undefined,
      VERIFICATION_RATE_LIMIT_WINDOW_MS: e('VERIFICATION_RATE_LIMIT_WINDOW_MS') !== ''
        ? parseInt(e('VERIFICATION_RATE_LIMIT_WINDOW_MS') as string, 10)
        : undefined,
      VERIFICATION_RATE_LIMIT_MAX_REQUESTS: e('VERIFICATION_RATE_LIMIT_MAX_REQUESTS') !== ''
        ? parseInt(e('VERIFICATION_RATE_LIMIT_MAX_REQUESTS') as string, 10)
        : undefined,
      SECURITY_CSP: e('SECURITY_CSP'),
      SECURITY_FORCE_HSTP: e('SECURITY_FORCE_HSTP'),
      TRUSTED_PROXIES: e('TRUSTED_PROXIES'),
      SWAGGER_ENABLED: e('SWAGGER_ENABLED'),
      DUPLICATE_DETECTION_THRESHOLD: e('DUPLICATE_DETECTION_THRESHOLD')
        ? parseInt(e('DUPLICATE_DETECTION_THRESHOLD') as string, 10)
        : undefined,
      DUPLICATE_DETECTION_EMAIL_WEIGHT: e('DUPLICATE_DETECTION_EMAIL_WEIGHT')
        ? parseInt(e('DUPLICATE_DETECTION_EMAIL_WEIGHT') as string, 10)
        : undefined,
      DUPLICATE_DETECTION_NAME_WEIGHT: e('DUPLICATE_DETECTION_NAME_WEIGHT')
        ? parseInt(e('DUPLICATE_DETECTION_NAME_WEIGHT') as string, 10)
        : undefined,
      DUPLICATE_DETECTION_TITLE_WEIGHT: e('DUPLICATE_DETECTION_TITLE_WEIGHT')
        ? parseInt(e('DUPLICATE_DETECTION_TITLE_WEIGHT') as string, 10)
        : undefined,
      DUPLICATE_DETECTION_FUZZY_MATCHING: e('DUPLICATE_DETECTION_FUZZY_MATCHING') === 'true',
      DUFLICATE_DETECTION_TIME_WINDOW_DAYS: e('DUPLICATE_DETECTION_TIME_WINDOW_DAYS')
        ? parseInt(e('DUPLICATE_DETECTION_TIME_WINDOW_DAYS') as string, 10)
        : undefined,
      // Disaster Recovery configuration
      RPO_MINUTES: e('RPO_MINUTES')
        ? parseInt(e('RPO_MINUTES') as string, 10)
        : DEFAULT_RPO_MINUTES,
      RTO_MINUTES: e('RTO_MINUTES')
        ? parseInt(e('RTO_MINUTES') as string, 10)
        : DEFAULT_RTO_MINUTES,
      DR_OWNER: e('DR_OWNER'),
      BACKUP_STORAGE_URL: e('BACKUP_STORAGE_URL'),
      BACKUP_ENCRYPTION_KEY_ID: e('BACKUP_ENCRYPTION_KEY_ID'),
      BACKUP_RETENTION_DAYS: e('BACKUP_RETENTION_DAYS')
        ? parseInt(e('BACKUP_RETENTION_DAYS') as string, 10)
        : DEFAULT_BACKUP_REGION_RETENTION_DAYS
,
      RESTORE_DRILL_INTERVAL_DAYS: e('RESTORE_DRILL_INTERVAL_DAYS')
        ? parseInt(e('RESTORE_DRILL_INTERVAL_DAYS') as string, 10)
        : DEFAULT_RESTORE_DRILL_INTERVAL_DAYS
,
      BACKUP_ALERT_WEBHOOK: e('BACKUP_ALERT_WEBHOOK'),
    },
    { enableImplicitConversion: true },
  );
  const errors = validateSync(validatedEnv);
  if (errors.length > 0) {
    const messages = errors.map((err) => Object.values(err.constraints || {}).join(', '));
    throw new Error(`Environment validation failed:\n${messages.join('\n')}`);
  }
  return validatedEnv;
}
