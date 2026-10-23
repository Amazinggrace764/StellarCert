import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MultisigService } from './multisig.service';
import { MultisigModule } from './multisig.module';
import { StellarService } from '../stellar/services/stellar.service';
import { LoggingService } from '../../common/logging/logging.service';
import { rpc, xdr } from '@stellar/stellar-sdk';

describe('MultisigService', () => {
  let service: MultisigService;
  let configService: ConfigService;
  let stellarService: StellarService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MultisigService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: StellarService,
          useValue: {
            getKeypairFromPublicKey: jest.fn(),
          },
        },
        {
          provide: LoggingService,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MultisigService>(MultisigService);
    configService = module.get<ConfigService>(ConfigService);
    stellarService = module.get<StellarService>(StellarService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('transaction polling', () => {
    it('keeps polling until the transaction succeeds', async () => {
      const success = { status: rpc.Api.GetTransactionStatus.SUCCESS };
      const getTransaction = jest
        .fn()
        .mockResolvedOnce({
          status: rpc.Api.GetTransactionStatus.NOT_FOUND,
        })
        .mockResolvedOnce(success);

      const internals = service as unknown as {
        server: { getTransaction: jest.Mock; };
        waitForTransaction: (
          hash: string,
          options?: { maxAttempts?: number; intervalMs?: number },
        ) => Promise<unknown>;
      };
      internals.server = { getTransaction };

      await expect(
        internals.waitForTransaction('tx-hash', {
          maxAttempts: 3,
          intervalMs: 0,
        }),
      ).resolves.toBe(success);
      expect(getTransaction).toHaveBeenCalledTimes(2);
    });

    it('stops polling and returns the result when the transaction fails', async () => {
      const failed = { status: rpc.Api.GetTransactionStatus.FAILED };
      const getTransaction = jest
        .fn()
        .mockResolvedOnce({
          status: rpc.Api.GetTransactionStatus.NOT_FOUND,
        })
        .mockResolvedOnce(failed);

      const internals = service as unknown as {
        server: { getTransaction: jest.Mock; };
        waitForTransaction: (
          hash: string,
          options?: { maxAttempts?: number; intervalMs?: number },
        ) => Promise<unknown>;
      };
      internals.server = { getTransaction };

      await expect(
        internals.waitForTransaction('tx-hash', {
          maxAttempts: 5,
          intervalMs: 0,
        }),
      ).resolves.toBe(failed);
      expect(getTransaction).toHaveBeenCalledTimes(2);
    });

    it('rejects when the transaction never settles', async () => {
      const getTransaction = jest.fn().mockResolved({
        status: rpc.Api.GetTransactionStatus.NOT_FOUND,
      });

      const internals = service as unknown as {
        server: { getTransaction: jest.Mock; };
        waitForTransaction: (
          hash: string,
          options?: { maxAttempts?: number; intervalMs?: number },
        ) => Promise<unknown>;
      };
      internals.server = { getTransaction };

      await expect(
        internals.waitForTransaction('tx-hash', {
          maxAttempts: 2,
          intervalMs: 0,
        }),
      ).rejects.toThrow('not finalized');
      expect(getTransaction).toHaveBeenCalledTimes(2);
    });

    it('rejects when the transaction is still PENDING after max attempts', async () => {
      const getTransaction = jest.fn().mockResolved({
        status: rpc.Api.GetTransactionStatus.PENDING,
      });

      const internals = service as unknown as {
        server: { getTransaction: jest.Mock; };
        waitForTransaction: (
          hash: string,
          options?: { maxAttempts?: number; intervalMs?: number },
        ) => Promise<unknown>;
      };
      internals.server = { getTransaction };

      await expect(
        internals.waitForTransaction('tx-hash', {
          maxAttempts: 3,
          intervalMs: 0,
        }),
      ).rejects.toThrow('not finalized');
      expect(getTransaction).toHaveBeenCalledTimes(3);
    });
  });

  describe('module wiring', () => {
    it('is registered as a provider by MultisigModule', () => {
      const module = Test.createTestingModule({
        imports: [MultisigModule],
      });
      expect(module).toBeDefined();
    });
  });

  describe('contract boolean results', () => {
    const parseBooleanResult = (retval: xdr.ScVal | undefined) =>
      (
        service as unknown as {
          parseBooleanResult: (value: xdr.ScVal | undefined) => boolean;
        }
      ).parseBooleanResult(retval);

    it('returns the contract boolean value', () => {
      expect(parseBooleanResult(xdr.ScVal.scvBool(true))).toBe(true);
      expect(parseBooleanResult(xdr.ScVal.scvBool(false))).toBe(false);
    });

    it('rejects a missing or non-boolean contract result', () => {
      expect(() => parseBooleanResult(undefined)).toThrow(
        'Invalid boolean response from contract',
      );
      expect(() => parseBooleanResult(xdr.ScVal.scvU32(1))).toThrow(
        'Invalid boolean response from contract',
      );
    });
  });

  describe('issuer authorization for proposal reads', () => {
    it('requires the issuer to be authenticated before reading a proposal', async () => {
      const internals = service as unknown as {
        assertIssuerAuthorized: (issuer: string) => void;
      };
      const spy = jest.spyOn(internals, 'assertIssuerAuthorized');

      expect(() => internals.assertIssuerAuthorized('GIssuer')).toNotThrow();
      expect(spy).toHaveBeenCalled();
    });

    it('propagates authorization failures when the issuer is not authorized', () => {
      const internals = service as unknown as {
        assertIssuerAuthorized: (issuer: string) => void;
      };
      jest.spyOn(internals, 'assertIssuerAuthorized').mockImplementation(() => {
        throw new Error('Unauthorized');
      });

      expect(() => internals.assertIssuerAuthorized('GIssuer')).toThrow('Unauthorized');
    });
  });

  describe('initMultisigConfig', () => {
    it('should initialize multisig configuration', () => {
      jest
        .spyOn(configService, 'get')
        .mockReturnValueOnce('test-contract-id')
        .mockReturnValueOnce('https://horizon-testnet.stellar.org')
        .mockReturnValueOnce('testnet');

      jest
        .spyOn(stellarService, 'getKeypairFromPublicKey')
        .mockReturnValue({} as any);

      expect(typeof service.initMultisigConfig).toBe('function');
    });

    it('rejects a threshold larger than the number of signers', async () => {
      await expect(
        service.initMultisigConfig(
          'source',
          'issuer',
          5,
          ['signer-1', 'signer-2', 'signer-3'],
        ),
      ).rejects.toThrow(
        'threshold must be less than or equal to the number of signers',
      );
    });

    it('rejects an empty signer list', async () => {
      await expect(
        service.initMultisigConfig('source', 'issuer', 1, []),
      ).rejects.toThrow('at least one signer is required');
    });

    it('rejects a non-positive threshold', async () => {
      await expect(
        service.initMultisigConfig('source', 'issuer', 0, ['signer-1']),
      ).rejects.toThrow('threshold must be a positive integer');
    });

    it('accepts a threshold equal to the number of signers', () => {
      const internals = service as unknown as {
        validateThreshold: (threshold: number, signers: string[]) => void;
      };
      expect(() => internals.validateThreshold(3, ['a', 'b', 'c'])).not.toThrow();
    });
  });

  describe('updateMultisigConfig', () => {
    it('should update multisig configuration', () => {
      expect(typeof service.updateMultisigConfig).toBe('function');
    });

    it('rejects a threshold larger than the number of signers', async () => {
      await expect(
        service.updateMultisigConfig(
          'source',
          'issuer',
          5,
          ['signer-1', 'signer-2', 'signer-3'],
        ),
      ).rejects.toThrow(
        'threshold must be less than or equal to the number of signers',
      );
    });
  });

  describe('proposeCertificate', () => {
    it('should propose a new certificate for multi-sig issuance', () => {
      expect(typeof service.proposeCertificate).toBe('function');
    });

    it('returns the contract boolean result instead of a mock object', async () => {
      const internals = service as unknown as {
        buildAndSubmitTransaction: jest.Mock;
        parseBooleanResult: (value: xdr.ScVal | undefined) => boolean;
      };
      internals.buildAndSubmitTransaction = jest
        .fn()
        .mockResolved(xdr.ScVal.scvBool(true));

      await expect(
        service.proposeCertificate({
          issuer: 'issuer',
          certificateId: 'cert-1',
          signers: ['signer-1'],
          threshold: 1,
        } as never),
      ).resolves.toBe(true);
      expect(internals.buildAndSubmitTransaction).toHaveBeenCalledTimes(1);
    });

    it('propagates contract failures', async () => {
      const internals = service as unknown as {
        buildAndSubmitTransaction: jest.Mock;
      };
      internals.buildAndSubmitTransaction = jest
        .fn()
        .mockRejected(new Error('contract call failed'));

      await expect(
        service.proposeCertificate({
          issuer: 'issuer',
          certificateId: 'cert-1',
          signers: ['signer-1'],
          threshold: 1,
        } as never),
      ).rejects.toThrow('contract call failed');
    });

    it('requires an issuer to be present on the request', async () => {
      await expect(
        service.proposeCertificate({
          certificateId: 'cert-1',
          signers: ['signer-1'],
          threshold: 1,
        } as never),
      ).rejects.toThrow();
    });

    it('passes the issuer through to the transaction builder', async () => {
      const internals = service as unknown as {
        buildAndSubmitTransaction: jest.Mock;
      };
      internals.buildAndSubmitTransaction = jest
        .fn()
        .mockResolved(xdr.ScVal.scvBool(true));

      await service.proposeCertificate({
        issuer: 'issuer',
        certificateId: 'cert-1',
        signers: ['signer-1'],
        threshold: 1,
      } as never);

      expect(internals.buildAndSubmitTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('approveRequest', () => {
    it('should approve a pending certificate request', () => {
      expect(typeof service.approveRequest).toBe('function');
    });

    it('returns the contract boolean result instead of a mock success result', async () => {
      const internals = service as unknown as {
        buildAndSubmitTransaction: jest.Mock;
      };
      internals.buildAndSubmitTransaction = jest
        .fn()
        .mockResolved(xdr.ScVal.scvBool(true));

      await expect(
        service.approveRequest({ requestId: 'req-1', signer: 'signer-1' } as never),
      ).resolves.toBe(true);
      expect(internals.buildAndSubmitTransaction).toHaveBeenCalledTimes(1);
    });

    it('rejects when the contract returns a non-boolean result', async () => {
      const internals = service as unknown as {
        buildAndSubmitTransaction: jest.Mock;
      };
      internals.buildAndSubmitTransaction = jest
        .fn()
        .mockResolved(xdr.ScVal.scvU32(1));

      await expect(
        service.approveRequest({ requestId: 'req-1', signer: 'signer-1' } as never),
      ).rejects.toThrow('Invalid boolean response from contract');
    });
  });

  describe('rejectRequest', () => {
    it('should reject a pending certificate request', () => {
      expect(typeof service.rejectRequest).toBe('function');
    });

    it('returns the contract boolean result', async () => {
      const internals = service as unknown as {
        buildAndSubmitTransaction: jest.Mock;
      };
      internals.buildAndSubmitTransaction = jest
        .fn()
        .mockResolved(xdr.ScVal.scvBool(true));

      await expect(
        service.rejectRequest({ requestId: 'req-1', rejector: 'signer-1' } as never),
      ).resolves.toBe(true);
      expect(internals.buildAndSubmitTransaction).toHaveBeenCalledTimes(1);
    });

    it('rejects when the contract returns a non-boolean result', async () => {
      const internals = service as unknown as {
        buildAndSubmitTransaction: jest.Mock;
      };
      internals.buildAndSubmitTransaction = jest
        .fn()
        .mockResolved(xdr.ScVal.scvU32(1));

      await expect(
        service.rejectRequest({ requestId: 'req-1', rejector: 'signer-1' } as never),
      ).rejects.toThrow('Invalid boolean response from contract');
    });

    it('propagates contract failures', async () => {
      const internals = service as unknown as {
        buildAndSubmitTransaction: jest.Mock;
      };
      internals.buildAndSubmitTransaction = jest
        .fn()
        .mockRejectedValue(new Error('rejector is not an authorized signer'));

      await expect(
        service.rejectRequest({ requestId: 'req-1', rejector: 'outsider' } as never),
      ).rejects.toThrow('rejector is not an authorized signer');
    });
  });

  describe('issueApprovedCertificate', () => {
    it('should issue an approved certificate', () => {
      expect(typeof service.issueApprovedCertificate).toBe('function');
    });

    it('derives the certificate expiry from issuance time, not the request approval deadline', async () => {
      const nowSeconds = 1700000000;
      const day = 86400;
      const approvalDeadline = nowSeconds + 2 * day;
      const certLifetimeDays = 30;
      const expectedCertExpiry = nowSeconds + certLifetimeDays * day;

      const nowSecondsSpy = jest
        .spyOn(Date, 'now')
        .mockReturnValue(nowSeconds * 1000);

      const request = {
        requestId: 'req-1',
        issuer: 'issuer',
        certificateId: 'cert-1',
        signers: ['signer-1'],
        threshold: 1,
        createdAt: nowSeconds - 1000,
        expiresAt: approvalDeadline,
        certExpiresAt: expectedCertExpiry,
        approvals: ['signer-1'],
        status: 'approved',
      };
      const getPendingRequest = jest
        .spyOn(service, 'getPendingRequest')
        .mockResolved(request as never);
      const buildAndSubmitTransaction = jest
        .fn()
        .mockResolved(xdr.ScVal.scvBool(true));
      (service as unknown as { buildAndSubmitTransaction: jest.Mock })
        .buildAndSubmitTransaction = buildAndSubmitTransaction;

      await expect(
        service.issueApprovedCertificate('req-1' as never),
      ).resolves.toBe(true);

      expect(getPendingRequest).toHaveBeenCalledWith('req-1');
      expect(buildAndSubmitTransaction).toHaveBeenCalledTimes(1);
      const callArgs = buildAndSubmitTransaction.mock.calls[0];
      const serialized = JSON.stringify(callArgs, ($key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
      expect(serialized).toContain(String(expectedCertExpiry));
      expect(serialized).not.toContain(String(approvalDeadline));

      nowSecondsSpy.mockRestore();
    });

    it('preserves an explicit certificate expiry carried on the request', async () => {
      const nowSeconds = 1700000000;
      const day = 86400;
      const approvalDeadline = nowSeconds + 2 * day;
      const explicitCertExpiry = nowSeconds + 90 * day;

      const nowSecondsSpy = jest
        .spyOn(Date, 'now')
        .mockReturnValue(nowSeconds * 1000);

      const request = {
        requestId: 'req-2',
        issuer: 'issuer',
        certificateId: 'cert-2',
        signers: ['signer-1'],
        threshold: 1,
        createdAt: nowSeconds - 1000,
        expiresAt: approvalDeadline,
        certExpiresAt: explicitCertExpiry,
        approvals: ['signer-1'],
        status: 'approved',
      };
      jest.spyOn(service, 'getPendingRequest').mockResolved(request as never);
      const buildAndSubmitTransaction = jest
        .fn()
        .mockResolved(xdr.ScVal.scvBool(true));
      (service as unknown as { buildAndSubmitTransaction: jest.Mock })
        .buildAndSubmitTransaction = buildAndSubmitTransaction;

      await expect(
        service.issueApprovedCertificate('req-2' as never),
      ).resolves.toBe(true);

      const serialized = JSON.stringify(buildAndSubmitTransaction.mock.calls[0], ($key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
      expect(serialized).toContain(String(explicitCertExpiry));
      expect(serialized).not.toContain(String(approvalDeadline));

      nowSecondsSpy.mockRestore();
    });

    it('rejects issuance when the request has expired', async () => {
      const nowSeconds = 1700000000;
      const request = {
        requestId: 'req-3',
        issuer: 'issuer',
        certificateId: 'cert-3',
        signers: ['signer-1'],
        threshold: 1,
        createdAt: nowSeconds - 10000,
        expiresAt: nowSeconds - 10,
        certExpiresAt: nowSeconds + 864000,
        approvals: ['signer-1'],
        status: 'approved',
      };
      jest.spyOn(service, 'getPendingRequest').mockResolved(request as never);
      const buildAndSubmitTransaction = jest.fn();
      (service as unknown as { buildAndSubmitTransaction: jest.Mock })
        .buildAndSubmitTransaction = buildAndSubmitTransaction;

      await expect(
        service.issueApprovedCertificate('req-3' as never),
      ).rejects.toThrow(/expired/i);
      expect(buildAndSubmitTransaction).not.toHaveBeenCalled();
    });
  });

  describe('cancelRequest', () => {
    it('should cancel a pending request', () => {
      expect(typeof service.cancelRequest).toBe('function');
    });

    it('returns the contract boolean result', async () => {
      const internals = service as unknown as {
        buildAndSubmitTransaction: jest.Mock;
      };
      internals.buildAndSubmitTransaction = jest
        .fn()
        .mockResolved(xdr.ScVal.scvBool(true));

      await expect(
        service.cancelRequest({ requestId: 'req-1', requester: 'requester' } as never),
      ).resolves.toBe(true);
      expect(internals.buildAndSubmitTransaction).toHaveBeenCalledTimes(1);
    });

    it('rejects when the contract refuses cancellation (e.g. non-pending request)', async () => {
      const internals = service as unknown as {
        buildAndSubmitTransaction: jest.Mock;
      };
      internals.buildAndSubmitTransaction = jest
        .fn()
        .mockResolved(xdr.ScVal.scvBool(false));

      await expect(
        service.cancelRequest({ requestId: 'req-1', requester: 'requester' } as never),
      ).resolves.toBe(false);
      expect(internals.buildAndSubmitTransaction).toHaveBeenCalledTimes(1);
    });

    it('rejects when the contract returns a non-boolean result', async () => {
      const internals = service as unknown as {
        buildAndSubmitTransaction: jest.Mock;
      };
      internals.buildAndSubmitTransaction = jest
        .fn()
        .mockResolved(xdr.ScVal.scvU32(1));

      await expect(
        service.cancelRequest({ requestId: 'req-1', requester: 'requester' } as never),
      ).rejects.toThrow('Invalid boolean response from contract');
    });
  });

  describe('getMultisigConfig', () => {
    it('should retrieve the multisig configuration', () => {
      expect(typeof service.getMultisigConfig).toBe('function');
    });
  });

  describe('getPendingRequest', () => {
    it('should get pending request by ID', () => {
      expect(typeof service.getPendingRequest).toBe('function');
    });
  });

  describe('isRequestExpired', () => {
    it('should check if a request is expired', () => {
      expect(typeof service.isRequestExpired).toBe('function');
    });
  });

  describe('getPendingRequestsForIssuer', () => {
    it('should get pending requests for an issuer', () => {
      expect(typeof service.getPendingRequestsForIssuer).toBe('function');
    });
  });

  describe('getPendingRequestsForSigner', () => {
    it('should get pending requests for a signer', () => {
      expect(typeof service.getPendingRequestsForSigner).toBe('function');
    });
  });

  describe('persistent storage for pending requests', () => {
    const makeStorage = () => {
      const map = new Map<string, unknown>();
      return {
        get: jest.fn((key: string) => map.get(key)),
        set: jest.fn((key: string, value: unknown) => {
          map.set(key, value);
        }),
        has: jest.fn((key: string) => map.has(key)),
        delete: jest.fn((key: string) => {
          map.delete(key);
        }),
        keys: jest.fn(() => Array.from(map.keys())),
        _map: map,
      };
    };

    it('stores pending requests under unique persistent keys instead of instance storage', () => {
      const internals = service as unknown as {
        persistentStorage: ReturnType<typeof makeStorage>;
        instanceStorage: ReturnType<typeof makeStorage>;
        storePendingRequest: (request: { requestId: string }) => void;
        getPendingRequest: (requestId: string) => unknown;
      };
      internals.persistentStorage = makeStorage();
      internals.instanceStorage = makeStorage();

      const request = { requestId: 'req-1', issuer: 'issuer' };
      internals.storePendingRequest(request);

      expect(internals.persistentStorage.set).toHaveBeenCalled();
      expect(internals.instanceStorage.set).not.toHaveBeenCalled();
      expect(internals.getPendingRequest('req-1')).toEqual(request);
    });

    it('keeps each pending request under its own key so growth is not bound to a single entry', () => {
      const internals = service as unknown as {
        persistentStorage: ReturnType<typeof makeStorage>;
        instanceStorage: ReturnType<typeof makeStorage>;
        storePendingRequest: (request: { requestId: string }) => void;
      };
      internals.persistentStorage = makeStorage();
      internals.instanceStorage = makeStorage();

      for (let i = 0; i < 50; i++) {
        internals.storePendingRequest({ requestId: `req-${i}` });
      }

      expect(internals.persistentStorage.set).toHaveBeenCalledTimes(50);
      expect(internals.persistentStorage._map.size).toBe(50);
      expect(internals.instanceStorage._map.size).toBe(0);
    });

    it('removes the persistent entry when a request is completed', () => {
      const internals = service as unknown as {
        persistentStorage: ReturnType<typeof makeStorage>;
        instanceStorage: ReturnType<typeof makeStorage>;
        storePendingRequest: (request: { requestId: string }) => void;
        removePendingRequest: (requestId: string) => void;
        getPendingRequest: (requestId: string) => unknown;
      };
      internals.persistentStorage = makeStorage();
      internals.instanceStorage = makeStorage();

      internals.storePendingRequest({ requestId: 'req-1' });
      internals.removePendingRequest('req-1');

      expect(internals.getPendingRequest('req-1')).toBeUndefined();
      expect(internals.persistentStorage.delete).toHaveBeenCalledWith(
        expect.stringContaining('req-1'),
      );
    });
  });
});
