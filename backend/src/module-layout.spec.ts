import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Guards the `src/` module layout.
 *
 * Stale copies of modules used to live as siblings of `modules/`
 * (`src/email/`, `src/metadata-schema/`, `src/security/`), each duplicating
 * the name of a real module under `src/modules/` while being imported by
 * nothing. They were removed in 6f4e469, but nothing stopped them — or a new
 * copy of the same mistake — from reappearing, and the ambiguity they create
 * (`src/security/...` vs `src/modules/security/...`) is invisible to tsc
 * because the dead files still compile.
 *
 * These assertions fail as soon as a top-level directory shadows a real
 * module, and as soon as an unexpected top-level directory appears at all,
 * so the layout stays reviewable instead of accumulating a second home for
 * every module.
 */

const SRC_ROOT = __dirname;
const MODULES_DIR = join(SRC_ROOT, 'modules');

/** Directories that are allowed as siblings of `modules/`. */
const ALLOWED_TOP_LEVEL_DIRS = new Set([
  'common',
  'config',
  'database',
  'modules',
  'utils',
]);

function directoriesIn(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((entry) => statSync(join(path, entry)).isDirectory())
    .sort();
}

describe('src/ module layout', () => {
  const topLevelDirs = directoriesIn(SRC_ROOT);
  const moduleDirs = directoriesIn(MODULES_DIR);

  it('only contains the known top-level directories', () => {
    const unexpected = topLevelDirs.filter(
      (dir) => !ALLOWED_TOP_LEVEL_DIRS.has(dir),
    );

    // A new top-level directory is usually a module placed in the wrong home:
    // it belongs under `src/modules/<name>/` unless it is shared infrastructure.
    expect(unexpected).toEqual([]);
  });

  it('has no top-level directory shadowing a real module', () => {
    const shadowed = topLevelDirs.filter(
      (dir) => dir !== 'modules' && moduleDirs.includes(dir),
    );

    // A name may resolve to exactly one directory inside src/: the module
    // under `src/modules/`. A sibling with the same name is a stale copy.
    expect(shadowed).toEqual([]);
  });

  it('keeps the modules that were previously duplicated under src/modules', () => {
    // These three had stale top-level copies (email, metadata-schema,
    // security). Their canonical home must keep existing.
    for (const name of ['email', 'metadata-schema', 'security']) {
      expect(existsSync(join(MODULES_DIR, name))).toBe(true);
    }
  });
});
