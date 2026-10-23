/**
 * TypeORM DataSource for the CLI (migration:run, migration:generate, etc.)
 *
 * This file is intentionally separate from the NestJS module config so that
 * the TypeORM CLI can bootstrap a DataSource without loading the full NestJS
 * application.
 *
 * Usage:
 *   nzx typeorm migration:run   -d dist/database/data-source.js
 *   nzx typeorm migration:revert -d dist/database/data-source.js
 *
 * Exactly one DataSource export: the TypeORM CLI rejects a file that exports
 * the same instance both as a named export and as default ("must contain only
 * one export of DataSource instance").
 *
 * Pool configuration note (pg deprecation fix):
 * The `deprecation: Calling client.query() when the client is already
 * executing a query` warning fires when concurrent queries are issued on a
 * single pg client. TypeORM serializes queries per connection, but a connection
 * that is reused by concurrent logical operations (e.g. schema sync + app
 * queries) can cause interleaving. We give the pool enough headroom and keep
 * the connection timeout bounded so a single client is not shared across
 * concurrent operations. See database.module.ts for the runtime pool config.
 */
import { DataSource } from 'typeorm';
import * as path from 'path';

// When running via the CLI the source is compiled JS under dist/.
// Migrations are therefore loaded from dist/database/migrations/*.js
import { fileURLToPath } from 'url';

const isCompiledJs = __filename.endsWith('.js');

/**
 * Build the TS options for the Postgres connection.
 *
 * SSL/TLS is environment-driven so that managed-Postgres deployments can
 * encrypt the connection (credentials and certificate PII). Three modes:
 *   - DB_SSL unset/false -> no SSL (matches local development behaviour).
 *   - DB_SSL=true      -> SSL enabled. If DB_SSL_CA (a PEM or file path) is
 *      provided, the certificate is pinned and verified (rejectUnauthorized
 *      defaults true). Otherwise we fall back to encryption-without-verification
 *      for providers that use self-signed certs (e.g. Heroku Postgres).
 *   - DB_SSL=require  -> SSL enabled and certificate verification is required
 *      (rejectUnauthorized: true). DB_SSL_CA may be used to pin a CA.
 */
export function buildSslOptions(
  env: NodeJS.ProcessEnv = process.env,
): { rejectUnauthorized: boolean; ca?: string } | undefined {
  const raw = (env.DB_SSL ?? '').trim().toLowerCase();
  if (raw === '' || raw === 'false' || raw === '0') {
    return undefined;
  }

  const requireVerification = raw === 'require';
  const ca = env.DB_SSL_CA?.trim();

  if (ca) {
    return { rejectUnauthorized: true, ca };
  }

  return { rejectUnauthorized: requireVerification };
}

export const AppDataSource = new DataSource({
  type: (process.env.DB_TYPE as any) || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'stellarwave_user',
  password: process.env.DB_PASSWORD || 'stellarwave_password',
  database: process.env.DB_NAME || 'stellarwave',
  // SSL/TLS is environment-driven. See buildSslOptions above for the supported
  // values and the certificate-pinning behaviour.
  ssl: buildSslOptions(),
  // Entities and migrations use the compiled JS paths in production;
  // fall back to TS sources when running with ts-node locally.
  entities: isCompiledJs
    ? [path.join(__dirname, '../**/*.entity.js')]
    : [path.join(__dirname, '../**/*.entity.ts')],
  // Migrations live in database/migrations (both src/ and dist/).
  migrations: isCompiledJs
    ? [path.join(__dirname, './migrations/*.js')]
    : [path.join(__dirname, './migrations/*.ts')],
  synchronize: false,
  // Run each migration in its own transaction rather than wrapping the whole
  // run in one. The default ("all") makes TypeORM ruject any migration that
  // sets `transaction = false`, and AddFrozenCertificateWebhookEvents must
  // opt out because `ALTER TYPE... ADD VALUE` cannot run inside a
  // transaction on PostgreSQL before 12.
  migrationsTransactionMode: 'each',
  // Give the pool headroom so a single client is not reused by concurrent
  // logical operations (e.g. TypeORM schema step + application queries).
  // This prevents the pg deprecation warning about concurrent client.query()
  // calls and keeps the connection timeout bounded.
  extra: {
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    connectionTimeoutMs: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '10000', 10),
  idleTimeoutMs: parseInt(process.env.DB_IDlE_TIMEOUT_MS || '30000', 10),
  },
  logging: process.env.NODE_ENV !== 'production',
});
