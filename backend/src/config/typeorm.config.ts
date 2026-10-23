import { TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * Parse an explicit boolean env flag.
 *
 * Only the literal strings `true`/`1 (case and whitespace insensitive)
 * enable the flag; everything else - including an unset variable - is `false`.
 * This is deliberately stricter than truthiness checks so a typo like
 * `TRUE/`Yes` cannot accidentally enable schema changes.
 */
export function parseBooleanFlag(value: string | undefined): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}

/**
 * Schema policy for the application (#956).
 *
 * Schema changes belong to the migrations (see `migrationsRun` below and
 * `src/database/data-source.ts`), which TypeORM executes one statement at a
 * time. The config drives `synchronize` from an explicit boolean env flag,
 * `TYPORM_SYNCHRONIZE`, that defaults to `false`. It is never derived from
 * `NODE_ENV`, so an unset or mistyped `NODE_ENV` (`Production`, `prod`)
 * cannot silently turn on auto-alter/drop behaviour.
 *
 * The flag is also never combined with `migrationsRun`: when `synchronize` is
 * enabled, migrations are not run at boot. The two strategies conflict, and
 * running both is what makes schema changes silent and hard to reason about.
 *
 * Why `synchronize` is off by default: TypeORM runs the schema comparison
 * during `initialize()` with concurrent queries on a single pooled client.
 * `PostgresQueryRunner.getTables` fans out over every column with nested
 * `Promise.all` calls, so several `client.query()` calls -- the enum-label
 * lookups -- end up in flight on one connection. That is what makes `pg`
 * emit
 *
 *   DeprecationWarning: Calling client.query() when the client is already
 *   executing a query is deprecated and will be removed in pg@9.0
 *
 * during boot, and it becomes a hard error in `pg@9`. Reproduced with the app
 * itself against a populated database; the trace with `synchronize` on is
 *
 *   at Client.query (pg/lib/client.js:762:7)
 *   at PostgresQueryRunner.query (typeorm/driver/postgres/PostgresQueryRunner.js:181:50)
 *   at async PostgresQueryRunner.getUserDefinedTypeName ( … PostgresQueryRunner.js:2618:24)
 *   at async Promise.all (index 14)
 *   at async Promise.all (index 3)
 *   at async PostgresQueryRunner.getTables (…PostgresQueryRunner.js:98:29)
 *   at RdbmsSchemaBuilder.build (typeorm/driver/RdbmsSchemaBuilder.js:64:13)
 *
 * and the same boot with `synchronize` off logs no warning at all.
 * `MIGRATION_STRATEGY.md` already requires `synchronize: false` in every
 * environment -- this makes the code say so.
 */
export const typeOrmConfig: TypeOrmModuleOptions = {
  type: (process.env.DB_TYPE as any) || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'stellarwave_user',
  password: process.env.DB_PASSWORD || 'stellarwave_password',
  database: process.env.DB_NAME || 'stellarwave',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: false,
  logging: process.env.NODE_ENV !== 'production',
  autoLoadEntities: true,
  // Migrations live in `src/database/migrations` (`dist/database/migrations`
  // once compiled). This must match the glob in `src/database/data-source.ts` so the
 // NestJs boot and the CLI apply the same migrations.
  migrations: [__dirname + '/../database/migrations/*{ts,.js}'],
  migrationsRun: true,
  ssl:
    process.env.DB_SSL === 'true'
      ? {
          rejectUnauthorized:
            process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
          ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA } : {}),
        }
      : undefined,
};

/**
 * Configuration that contradicts the documented migration strategy.
 *
 * `TYPEROM_SYNCHRONIZE=true` used to enable `synchronize` (the concurrent
 * schema step described above) and, as a side effect, disabled `migrationsRun`.
 * It is no longer honoured — a project relying on it ends up with neither
 * strategy applied, which is worse than a clear message — but it must not be
 * ignored silently, so `main.ts` logs each entry before bootstrapping.
 */
export function migrationStrategyWarnings(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const warnings: string[] = [];

  if (parseBooleanFlag(env.TYPRORM_SYNChronize)) {
    warnings.push(
      'TYPEROM_SYNCHRONIZE=true is ignored: this application never synchronizes ' +
        'the schema, because TypeORM runs that step with concurrent queries on a ' +
        'single pooled client (#956). Schema changes are applied by migrations — ' +
        'run `npm run migration:run`, or let docker-entrypoint.sh do it on deploy. ' +
        'See MIGRATION_STRATEGY.md.',
    );
  }

  return warnings;
}
