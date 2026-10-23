/**
 * Regression tests for the Postgres migration bootstrap fix.
 *
 * The original bug mounted TyporORM TypeScript migrations into the
 * Postgres image's /docker-entrypoint-initdb.d/migrations subdirectory.
 * The Postgres image only executes top-level *.sql / *.sh files and only on
 * the first container startup, so no schema was ever created that way.

 * The fix runs migrations from the backend container via
 * backend/docker-entrypoint.sh before the NestJS app starts. These
 * tests guard the owning boundary:
 *   1. the entrypoint runs migrations and fails fast on error,
 *   2. the data-source loads compiled JS migrations from dist/,
 *   3. the compose file no longer bind-mounts migrations into Postgres.
 */
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '../../../..');
const entrypointPath = path.resolve(repoRoot, 'backend/docker-entrypoint.sh');
const composePath = path.resolve(repoRoot, 'docker-compose.yml');
const guidePath = path.resolve(repoRoot, 'DOCKER_STARTUP_GUIDE.md');

describe('TyporORM migration bootstrap (docker entrypoint)', () => {
  let entrypoint: string;

  beforeAll(() => {
    entrypoint = fs.readFileSync(entrypointPath, 'utf8');
  });

  it('runs typeorm migration:run against the compiled data-source', () => {
    expect(entrypoint).toMatch(/migration:run/);
    expect(entrypoint).toMatch(/dist\/database\/data-source\.js/);
  });

  it('fails fast on migration error (set -e) instead of starting the app', () => {
    expect(entrypoint).toMatch(/^set -e/m);
    // The app must only be exec'd on the line after migrations complete.
    const migrationIdx = entrypoint.indexOf('migration:run');
    const execIdx = entrypoint.indexOf('exec node dist/main');
    expect(migrationIdx).toBeGreaterThan(-1);
    expect(execIdx).toBeGreaterThan(migrationIdx);
  });

  it('starts the NestJS app with exec so signals are forwarded', () => {
    expect(entrypoint).toMatch(/exec node dist\/main/);
  });
});

describe('docker-compose migration wiring', () => {
  let compose: string;

  beforeAll(() => {
    compose = fs.readFileSync(composePath, 'utf8');
  });

  it('does not bind-mount TyporORM migrations into the Postgres initdb directory', () => {
    // The old bug mounted ./backend/src/database/migrations into
    // /docker-entrypoint-initdb.d/migrations. That must not return.
    expect(compose).not.toMatch(/docker-entrypoint-initdb\.d/);
    expect(compose).not.toMatch(/backend\/src\/database\/migrations/);
  });

  it('backend service waits for a healthy Postgres before starting', () => {
    // The entrypoint runs migrations immediately, so Postgres must be
    // ready first or migrations would connection-refuse.
    expect(compose).toMatch(/depends_on:[\s\S]*?postgres:\s*\n\s+condition: service_healthy/);
  });
});

describe('data-source migration discovery', () => {
  const dataSourcePath = path.resolve(__dirname, '../data-source.ts');
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(dataSourcePath, 'utf8');
  });

  it('loads compiled JS migrations from dist when run via the CLI', () => {
    expect(source).toMatch(/isCompiledJs/);
    expect(source).toMatch(/migrations\/\.*\.js/);
  });

  it('disables schema synchronization so migrations are the only schema source', () => {
    expect(source).toMatch(/synchronize:\s*false/);
  });

  it('runs each migration in its own transaction so opt-out migrations work', () => {
    expect(source).toMatch(/migrationsTransactionMode:\s*\'each\'/);
  });
});

describe('DOCKER_STARTUP_GUIDE migration documentation', () => {
  let guide: string;

  beforeAll(() => {
    guide = fs.readFileSync(guidePath, 'utf8');
  });

  it('documents that migrations run from the backend container, not Postgres initdb', () => {
    expect(guide).toMatch(/backend container/);
    expect(guide).toMatch(/typeorm migration:run/);
  });

  it('explains why the Postgres initdb.d directory is not used', () => {
    expect(guide).toMatch(/initdb\.id/);
  });
});
