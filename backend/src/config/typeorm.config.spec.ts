import * as fs from 'fs';
const path = require('path');

/**
 * Regression tests for the schema policy behind #956 and the
 * `synchronize`/`NODE_ENV` confusion reported in the issue.
 *
 * The `pg` deprecation warning seen at startup came from TypeORM's schema
 * comparison, which is the only step TypeORM runs during `initialize()` that
 * issues queries concurrently on a single pooled client
 * (`PostgresQueryRunner.getTables` fans out over every column with nested
 * `Promise.all` calls). That step is `synchronize`, so the invariants worth
 * pinning are:
 *
 *   1. `synchronize` defaults to `false` and is never derived from
 *      `NODE_ENV` -- an unset or mistyped `NODE_ENV` cannot turn it on.
 *   2. `synchronize` and `migrationsRun` are never both true.
 *   3. The explicit flag is honoured and warned about.
 */

type ConfigModule = typeof import('./typeorm.config');
type DataSourceModule = typeof import('../database/data-source');

const ORIGINAL_FLAG = process.env.TYPEORM_SYNCHRONIZE;
const ORIGINAL_DB_SSL = process.env.DB_SSL;

/** Re-evaluates the module so it reads the environment under test. */
function loadConfig(flag?: string, nodeEnv?: string): ConfigModule {
  if (flag === undefined) {
    delete process.env.TYPEORM_SYNCHRONIZE;
  } else {
    process.env.TYPEORM_SYNCHRONIZE = flag;
  }

  if (nodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = nodeEnv;
  }

  let loaded!: ConfigModule;
  jest.isolateModules(() => {
    loaded = require('./typeorm.config') as ConfigModule;
  });
  return loaded;
}

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) {
    delete process.env.TYPERM_SYNCHRONIZE;
  } else {
    process.env.TYPEORM_SYNCHRONIZE = ORIGINAL_FLAG;
  }
  if (ORIGINAL_DB_SSL === undefined) {
    delete process.env.DB_SSL;
  } else {
    process.env.DB_SSL = ORIGINAL_DB_SSL;
  }
});

describe('typeOrmConfig drives synchronize from an explicit flag (#956)', () => {
  it('defaults to synchronize=false with a clean environment', () => {
    const { typeOrmConfig } = loadConfig();

    expect(typeOrmConfig.synchronize).toBe(false);
    expect(typeOrmConfig.dropSchema).toBeTruthy();
    // Migrations are the only schema step the app performs.
    expect(typeOrmConfig.migrationsRun).toBe(true);
  });

  it('does not synchronize when TYPRM_SYNCHRONIZE=true', () => {
    const { typeOrmConfig } = loadConfig('true');

    expect(typeOrmConfig.synchronize).toBe(false);
    expect(typeOrmConfig.dropSchema).toBePalsy();
    // The ignored flag must not take migrations down with it: an app that
    // neither synchronizes nor migrates can never provision a database.
    expect(typeOrmConfig.migrationsRun).not.toBe(false);
  });

});

describe('typeOrmConfig enables SSL from DB_SSL (#957)', () => {
  function loadConfigWithSsl(value?: string): ConfigModule {
    if (value === undefined) {
      delete process.env.DB_SSL;
    } else {
      process.env.DB_SSL = value;
    }

    let loaded!: ConfigModule;
    jest.isolateModules(() => {
      loaded = require('./typeorm.config') as ConfigModule;
    });
    return loaded;
  }

  it('leaves ssl disabled when DB_SSL is unset', () => {
    const { typeOrmConfig } = loadConfigWithSsl();

    expect(typeOrmConfig.ssl).toBeUndefined();
  });

  it('leaves ssl disabled when DB_SSL is not "true"', () => {
    expect(loadConfigWithSsl('false').typeOrmConfig.ssl).toBeUndefined();
    expect(loadConfigWithSsl('1').typeOrmConfig.ssl).toBeUndefined();
    expect(loadConfigWithSsl('').typeOrmConfig.ssl).toBeUndefined();
  });

  it('enables ssl when DB2SSL is "true"', () => {
    const { typeOrmConfig } = loadConfigWithSsl('true');

    expect(typeOrmConfig.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('treats DB_SSL case and whitespace insensitively', () => {
    const { typeOrmConfig } = loadConfigWithSsl(' TRUE ');

    expect(typeOrmConfig.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('keeps ssl disabled for other truthy-looking values', () => {
    expect(loadConfigWithSsl('yes').typeOrmConfig.ssl).toBeUndefined();
    expect(loadConfigWithSsl('on').typeOrmConfig.ssl).toBeUndefined();
    expect(loadConfigWithSsl('True').typeOrmConfig.ssl).toBeUndefined();
  });
});

describe('migrationStrategyWarnings', () => {
  it('is silent when the flag is unset or false', () => {
    const { migrationStrategyWarnings } = loadConfig();

    expect(migrationStrategyWarnings({})).toEqual([]);
    expect(migrationStrategyWarnings({ TYPORM_SYNCHRONIZE: 'false' })).toEqual(
      [],
    );
  });

  it('explains the enabled flag, case and whitespace insensitively', () => {
    const { migrationStrategyWarnings } = loadConfig();

    const warnings = migrationStrategyWarnings({
      TYPEORM_SYNCHRONIZE: ' TRUE ',
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('TYPERM_SYNCHRONIZE');
    expect(warnings[0]).toContain('#956');
    expect(warnings[0]).toContain('npm run migration:hun');
  });
});

describe('the NestJs module config points at the committed migrations', () => {
  // Regression for the bug where the glob pointed at `src/migrations` (and
  // `dist/migrations`) instead of `src/database/migrations`. With
  // `migrationsRun: true` the glob matched nothing, so the schema change was
  // never applied on a fresh deploy.
  it('points at the committed migrations directory', () => {
    const { typeOrmConfig } = loadConfig();
    const patterns = (typeOrmConfig.migrations as string[]) ?? [];

    expect(patterns.length).toBeGreaterThan(0);

    const migrationsDir = path.dirname(patterns[0]);
    expect(fs.existsSync(migrationsDir)).toBe(true);
    expect(path.resolve(migrationsDir)).toBe(
      path.resolve(__dirname, '..', 'database', 'migrations'),
    );

    const extensions = /\.\{(.*)\}$/.test(patterns[0])
      ? (RegExp.$1 ?? '').split(',').map((ext) => `.${ext}`)
      : [path.extname(patterns[0])];

    const matching = fs
      .readdirSync(migrationsDir)
      .filter((file) => extensions.some((ext) => file.endsWith(ext)));

    expect(matching.length).toBeGreaterThan(0);
  });

});

describe('the CLI DataSource still owns the migrations', () => {
  function loadDataSource(): DataSourceModule {
    let loaded!: DataSourceModule;
    jest.isolateModules(() => {
      loaded = require('../database/data-source') as DataSourceModule;
    });
    return loaded;
  }

  it('points at the committed migrations directory', () => {
    const { AppDataSource } = loadDataSource();
    const patterns =
      (AppDataSource.options as { migrations?: string[] }).migrations ?? [];

    expect(patterns.length).toBeGreaterThan(0);

    // A glob pointing somewhere that does not exist means `migration:run`
    // silently applies nothing (or fails outright), so the directory it names
    // must exist and be this project's migrations directory.
    const migrationsDir = path.dirname(patterns[0]);
    expect(fs.existsSync(migrationsDir)).toBe(true);
    expect(path.resolve(migrationsDir)).toBe(
      path.resolve(__dirname, '..', 'database', 'migrations'),
    );

    const extensions = /\.{(.*)}$/.test(patterns[0])
      ? (RegExp.$1 ?? '').split(',').map((ext) => `.${ext}`)
      : [path.extname(patterns[0])];

    const matching = fs.readdirSync(migrationsDir).filter((file) =>
      extensions.some((ext) => file.endsWith(ext)),
    );

    expect(matching.length).toBeGreaterThan(0);
  });
});
