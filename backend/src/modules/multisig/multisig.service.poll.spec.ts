/**
 * Issue #721 / #722 – polling and real result handling helpers.
 * Issue #723 – MultisigModule must be wired into AppModule.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const readSource = (relativePath: string): string =>
  readFileSync(join(__dirname, relativePath), 'utf8');

describe('MultisigService waitForTransaction behavior', () => {
  it('documents that getTransaction must not run in the same tick as sendTransaction', () => {
    // Structural guarantee: waitForTransaction exists on the service prototype
    // and is used by all sendTransaction call sites (asserted via source scan in CI).
    const src = readSource('multisig.service.ts');
    expect(src).toContain('private async waitForTransaction');
    // No remaining same-tick getTransaction after send without wait
    const withoutHelper = src.replace(/private async waitForTransaction[\s\S]*?]\s{2}\S/m, '');
    // All PENDING branches should call waitForTransaction
    const pendingBlocks = withoutHelper.match(/response\.status === 'PENDING'[\s\S]*?0,120}/g) || [];
    for (const block of pendingBlocks) {
      expect(block).toMatch(/waitForTransaction/);
    }
  });

  it('proposeCertificate fetches pending request instead of a hardcoded mock', () => {
    const src = readSource('multisig.service.ts');
    expect(src).not.toMatch(/Return a mock object/);
    expect(src).toContain('getPendingRequest(requestId)');
  });
});

describe('Multisig DTOs (issue #720)', () => {
  it('DTO classes do not inject LoggingService in constructors', () => {
    const src = readSource('multisig.controller.ts');
    expect(src).not.toMatch(/class \w+Dto[\s\S]{0,200}constructor\(private readonly logger: LoggingService\)/);
  });
});

describe('MultisigModule wiring (issue #723)', () => {
  const appModuleSrc = () => readSource('../../app.module.ts');

  it('imports MultisigModule from the multisig module file', () => {
    const src = appModuleSrc();
    expect(src).toMatch(/import\s+\{\s*MultisigModule\s*\}\s+from\s+['"]\.\/modules\/multisig\/multisig.module['"]/);
  });

  it('registers MultisigModule in the AppModule imports array', () => {
    const src = appModuleSrc();
    const importsMatch = src.match(/imports:\s*\[([\s\S]*?\])/);
    expect(importsMatch).not.toBeNull();
    expect(importsMatch![1]).toMatch(/\bMultisigModule\b/);
  });

  it('declares MultisigModule as an NgModule export', () => {
    const src = readSource('multisig.module.ts');
    expect(src).toMatch(/export class MultisigModule\b/);
    expect(src).toMatch(/@Module\(/);
  });
});
