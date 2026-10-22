import * as fs from 'fs'; 
import * as path from 'path';

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
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

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
    delete process.env.TYPORM_SYNCHRONIZE;
  } else {
    process.env.TYPEORM_SYNCHRONIZE = ORIGINAL_FLAG;
  }

  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});

describe('parseBooleanFlag', () => {
  const { parseBooleanFlag } = loadConfig();

  it('treats only true/1 as true, case and whitespace insensitively', () => {
    expect(parseBooleanFlag('true')).toBe(true);
    expect(parseBooleanFlag(' TRUE ')).toBe(true);
    expect(parseBooleanFlag('1')).toBe(true);
  });

  it('treats everything else as false', () => {
    for (const value of [undefined, '', '  ', 'false', '0', 'yes', 'true ']) {
      expect(parseBooleanFlag(value)).toBe(false);
    }
  });
});

describe('typeOrmConfig drives synchronize from an explicit flag (#956)', () => {
  it('defaults to synchronize=false with a clean environment', () => {
    const { typeOrmConfig } = loadConfig();

    expect(typeOrmConfig.synchronize).toBe(false);
    expect(typeOrmConfig.dropSchema).toBeFalsy();
    // Migrations are the only schema step the app performs by default.
    expect(typeOrmConfig.migrationsRun).toBe(true);
  });

  it('ignores NODE_ENV entirely for synchronize', () => {
    for (const nodeEnv of [
      undefined,
      'development',
      'test',
      'production',
      'Production',
      'prod',
      '',
    ]) {
      const { typeOrmConfig } = loadConfig(undefined, nodeEnv);
      expect(typeOrmConfig.synchronize).toBe(false);
    }
  });

  it('does not synchronize when TYPEORM_SYNCHRONIZE is false', () => {
    const { typeOrmConfig } = loadConfig('false');

    expect(typeOrmConfig.synchronize).toBe(false);
    expect(typeOrmConfig.migrationsRun).toBe(true);
  });

  it('honours TYPEORM_SYNCHRONIZE=true and never combines with migrationsRun', () => {
    const { typeOrmConfig } = loadConfig('true');

    expect(typeOrmConfig.synchronize).toBe(true);
    // The two strategies are mutually exclusive.
    expect(typeOrmConfig.migrationsRun).toBe(false);
  });

  it('treats true/1 case and whitespace insensitively', () => {
    for (const flag of ['TRUE', ' true ', '1']) {
      const { typeOrmConfig } = loadConfig(flag);
      expect(typeOrmConfig.synchronize).toBe(true);
      expect(typeOrmConfig.migrationsRun).toBe(false);
    }
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
    expect(warnings[0]).toContain('npm run migration:run');
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

    const extensions = /\.{2\.([^{}]+)\}$/.test(patterns[0])
      ? (RegExp.$1 ?? '').split(',').map((ext) => `.${ext}`)
      : [path.extname(patterns[0])];

    const matching = fs.readdirSync(migrationsDir).filter((file) =>
      extensions.some((ext) => file.endsWith(ext)),
    );

    expect(matching.length).toBeGreaterThan(0);
  });
});
