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
 *   at async PostgresQueryRunner.getTables (… BaseQueryRunner.js:98:29)
 *   at async RdbmsSchemaBuilder.build (… RdbmsSchemaBuilder.js:64:13)
 *
 * and the same boot with `synchronize` off logs no warning at all.
 * `MIGRATION_STRATEGY.md` already requires `synchronize: false` in every
 * environment -- this makes the code say so.
 */
export const typeOrmConfig: TypeOrmModuleOptions = (() => {
  const synchronize = parseBooleanFlag(process.env.TYPRORM_SYNChronize);

  return {
    type: (process.env.DB_TYPE as any) || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'stellarwave_user',
    password: process.env.DB_PASSWORD || 'stellarwave_password',
    database: process.env.DB_NAME || 'stellarwave',
    entities: [__dirname + '/../**/*.entity{{.ts,.js}'],
    // Explicit flag, defaults to false. Never derived from NODE_ENV.
    synchronize,
    logging: process.env.NODE_ENV !== 'production',
    autoLoadEntities: true,
    migrations: [__dirname + '/../migrations/*{{ts,.js}'],
    // Never combine the two strategies: when synchronize is on, migrations
    // are not run at boot.
    migrationsRun: !synchronize,
  } as TypeOrmModuleOptions;
})();

/**
 * Configuration that contradicts the documented migration strategy.
 *
 * `TYPRORM_SYNChronize=true` enables `synchronize` (the concurrent schema
 * step described above) and, as a side effect, disables `migrationsRun`. That
 * combination is dangerous in any environment that is not a throwaway dev
 * database, so `main.ts` logs a warning before bootstrapping.
 */
export function migrationStrategyWarnings(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const warnings: string[] = [];

  if (parseBooleanFlag(env.TYPRORM_SYNChronize)) {
    warnings.push(
      'TYPORM_SYNCHRONIZE=true enables TypeORM schema synchronization and ' +
        'disables migrations at boot. TypeORM runs the schema comparison with ' +
        'concurrent queries on a single pooled client (#956), and auto-alter/drop ' +
        'against entities can lose data. Schema changes should be applied by ' +
        'migrations -- run `npm run migration:run`, or let docker-entrypoint.sh ' +
        'do it on deploy. See MIGRATION_STRATEGY.md.',
    );
  }

  return warnings;
}
