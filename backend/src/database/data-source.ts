/**
 * TypeORM DataSource for the CLI (migration:run, migration:generate, etc.)
 *
 * This file is intentionally separate from the NestJS module config so that
 * the TypeORM CLI can bootstrap a DataSource without loading the full NestJS
 * application.
 *
 * Usage:
 *   npx typeorm migration:run   -d dist/database/data-source.js
 *   npx typeorm migration:revert -d dist/database/data-source.js
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
const isCompiledJs = __filename.endsWith('.js');

export const AppDataSource = new DataSource({
  type: (process.env.DB_TYPE as any) || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'stellarwave_user',
  password: process.env.DB_PASSWORD || 'stellarwave_password',
  database: process.env.DB_NAME || 'stellarwave',
  // Entities and migrations use the compiled JS paths in production;
  // fall back to TS sources when running with ts-node locally.
  entities: isCompiledJs
    ? [path.join(__dirname, '../**/*.entity.js')]
    : [path.join(__dirname, '../**/*.entity.ts')],
  migrations: isCompiledJs
    ? [path.join(__dirname, './migrations/*.js')]
    : [path.join(__dirname, './migrations/*.ts')],
  synchronize: false,
  // Run each migration in its own transaction rather than wrapping the whole
  // run in one. The default ("all") makes TypeORM reject any migration that
  // sets `transaction = false`, and AddFrozenCertificateWebhookEvents must
  // opt out because `ALTER TYPE ... ADD VALUE` cannot run inside a
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
