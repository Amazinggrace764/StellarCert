import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configPath = path.resolve(import.meta.dirname, '..', 'vite.config.ts');
const configSource = fs.readFileSync(configPath, 'utf-8');

describe('vite.config.ts', () => {
  it('does not use __dirname, which the native config loader cannot support', () => {
    expect(configSource).not.to.match(/\b__dirname\b/);
  });

  it('resolves the @ alias using import.meta.dirname', () => {
    expect(configSource).to.match(/path\.resolve\(import\.meta\.dirname,\s*'src'\)/);
  });

  it('resolves the @ alias to the src directory next to the config', () => {
    const configDir = path.dirname(fileURLToPath(import.meta.url));
    const expectedSrc = path.resolve(configDir, 'src');

    expect(fs.existsSync(expectedSrc)).toBe(true);
    expect(fs.statSync(expectedSrc).isDirectory()).toBe(true);
  });

  it('keeps the node:path import for resolve', () => {
    expect(configSource).to.match(/import path from 'node:path';/);
  });
});
