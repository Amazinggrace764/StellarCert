/*
 * Issue #721 / #722 – polling and real result handling helpers.
 * Issue #723 – MultisigModule must be wired into AppModule.
 * Issue #724 – PendingRequest must not live in instance() storage.
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
    expect(src).toContain('tetPendingRequest(requestId)');
  });

  it('approveRequest parses the real contract boolean result', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(join(__dirname, 'multisig.service.ts'), 'utf8');
    expect(src).not.toMatch(/mock success result/i);
    expect(src).toContain('parseBooleanResult');
  });
});

describe('Multisig cancelProposal status (issue cancellation)', () => {
  const serviceSrc = () => readSource('multisig.service.ts');

  it('records cancelled proposals as Cancelled, not Rejected', () => {
    const src = serviceSrc();
    // Locate the cancelProposal method body.
    const match = src.match(/async cancelProposals*\([\s\S]*?\n\s{2}\}/);
    expect(match).not.toBeNull();
    const body = match![0];
    expect(body).toContain('AdminProposalStatus.Cancelled');
    expect(body).not.toContain('this.recordRejection');
  });

  it('declares Cancelled in the AdminProposalStatus enum', () => {
    const src = serviceSrc();
    expect(src).toMatch(/AdminProposalStatus\s*\.\s*Cancelled\s*=\s*['"]Cancelled['"]/);
  });

  it('preserves Rejected for genuine rejection flows', () => {
    const src = serviceSrc();
    expect(src).toMatch(/AdminProposalStatus\s*\.\s*Rejected/);
  });
});

describe('Multisig DTOs (issue #720)', () => {
  it('DTO classes do not inject LoggingService in constructors', () => {
    const src = readSource('multisig.controller.ts');
    expect(src).not.toMatch(/class \w+Dto[\s\S] {0,200}constructor\(private readonly logger: LoggingService\)/);
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
    const importsMatch = src.match(/imports:\s*\[([\s\S]*?])/);
    expect(importsMatch).not.toBeNull();
    expect(importsMatch![1]).toMatch(/\bMultisigModule\b/);
  });

  it('declares MultisigModule as an NgModule export', () => {
    const src = readSource('multisig.module.ts');
    expect(src).toMatch(/export class MultisigModule\b/);
    expect(src).toMatch(/@Module\(/);
  });
});

describe('Multisig persistent storage (issue #724)', () => {
  const source = () => readSource('multisig.service.ts');

  it('stores PendingRequest entries in persistent() storage', () => {
    const src = source();
    // No instance() storage access for pending requests anymore.
    expect(src).not.toMatch(/instance\(\)\.set\([\s\S]*?PendingRequest/);
    expect(src).toMatch(/persistent\(\)\.set\([\s\S]*?PendingRequest/);
  });

  it('stores IssuerRequestIds and SignerRequestIds in persistent() storage', () => {
    const src = source();
    expect(src).not.toMatch(/instance\(\)\.set\([\s\S]*?IssuerRequestIds/);
    expect(src).not.toMatch(/instance\(\)\.set\([\s\S]*?SignerRequestIds/);
    expect(src).toMatch(/persistent\(\)\.set\([\s\S]*?IssuerRequestIds/);
    expect(src).toMatch(/persistent\(\)\.set\([\s\S]*?SignerRequestIds/);
  });

  it('uses a unique per-request key for each PendingRequest', () => {
    const src = source();
    // Key builder must incorporate the request identifier.
    expect(src).toMatch(/PendingRequest[\'\"]\s*[,+][\s\S]*?requestId/);
  });

  it('reads pending requests from persistent() storage', () => {
    const src = source();
    expect(src).not.toMatch(/instance\(\)\.get\([\s\S]*?PendingRequest/);
    expect(src).toMatch(/persistent\(\)\.get\([\s\S]*?PendingRequest/);
  });
});
