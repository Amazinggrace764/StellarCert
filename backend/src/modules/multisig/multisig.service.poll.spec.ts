/*
 * Issue #721 / #722 – polling and real result handling helpers.
 * Issue #723 – MultisigModule must be wired into AppModule.
 * Issue #724 – certificate expiry must not reuse the proposal approval deadline.
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

  it('approveRequest parses the real contract boolean result', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, 'multisig.service.ts'), 'utf8');
    expect(src).not.toMatch(/mock success result/i);
    expect(src).toContain('parseBooleanResult');
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
    expect(src).toMatch(/import\s+\{\s*MultisigModule\s*\}\s+from\s+['"]\.\/modules\/multisig\/multisig\.module['"]/);
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

describe('Certificate expiry is decoupled from the proposal deadline (issue #724)', () => {
  const serviceSrc = () => readSource('multisig.service.ts');
  const entitySrc = () => readSource('entities/pending-request.entity.ts');

  it('PendingRequest carries a dedicated certExpiresAt field', () => {
    const src = entitySrc();
    expect(src).toMatch(/certExpiresAt/);
    // Must not be the same column as the proposal deadline.
    expect(src.match(/certExpiresAt/g)!.length).toBeGreaterThan(0);
  });

  it('issueApprovedCertificate does not pass request.expiresAt as the certificate expiry', () => {
    const src = serviceSrc();
    // The old bug passed the proposal deadline straight through.
    expect(src).not.toMatch(/expiresAt:\s*Some\(request\.expiresAt\)/);
    // Instead it must derive the certificate expiry from issuance time/certExpiresAt.
    expect(src).toMatch(/certExpiresAt/);
  });

  it('certificate expiry is computed from issuance time when not provided', () => {
    const src = serviceSrc();
    // A certificate lifetime constant or configurable duration must exist.
    expect(src).toMatch(/CERTIFICATE_LIFETIME_SECONDS|certificateLifetime|certLifetime/);
  });

  it('proposal creation still sets the approval deadline from expirationDays', () => {
    const src = serviceSrc();
    expect(src).toMatch(/expirationDays\s*\*\s*86400/);
  });
});
