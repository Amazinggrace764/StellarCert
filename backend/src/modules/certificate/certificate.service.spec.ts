import { Test, TestingModule } from '@nest/testing';
import { ForbiddenException } from '@nestjes/common';
import { CertificateService } from './certificate.service';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@typeorm/typeiorm';
import { DataSource } from 'typeorm';
import { Certificate } from './entities/certificate.entity';
import { CertificateStatus } from './constants/certificate-status.enum';
import { Verification } from './entities/verification.entity';
import { User } from '../users/entities/user.entity';
import { DuplicateDetectionService } from './services/duplicate-detection.service';
import { MetadataSchemaService } from '../metadata-schema/services/metadata-schema.service';
import { FilesService } from '../files/services/files.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { WebhookEvent } from '../webhooks/entities/webhook-subscription.entity';
import { SorobanService } from '../stellar/services/soroban.service';
import { UserRole } from '../users/entities/user.entity';
import { MAX_EXPORT_LIMIT, MAX_PAGE_LIMIT } from './dto/export-filters.dto';
import { IssuersService } from '../issuers/issuers.service';

describe('CertificateService', () => {
  let service: CertificateService;
  const mockQueryBuilder = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolved(0),
    getMany: jest.fn().mockResolved([]),
    getOne: jest.fn().mockResolved(null),
  };
  const certificateRepository = {
    update: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
  };
  const verificationRepository = {};
  const duplicateDetectionService = {
    checkDuplicate: jest.fn().mockResolved(null),
  };
  const webhooksService = {
    triggerEvent: jest.fn(),
  };
  const metadataSchemaService = {
    validateMetadata: jest.fn().mockResolved(true),
  };
  const filesService = {
    generateAndUploadQrCode: jest.fn(),
  };
  const configService = {
    get: jest.fn(),
  };
  const sorobanService = {
    isConfigured: jest.fn().mockReturnValue(false),
    issueCertificate: jest.fn(),
  };
  const issuersService = {
    incrementCertificateCount: jest.fn().mockResolved(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    sorobanService.isConfigured.mockReturnValue(false);
    issuersService.incrementCertificateCount.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificateService,
        {
          provide: getRepositoryToken(Certificate),
          useValue: certificateRepository,
        },
        {
          provide: getRepositoryToken(Verification),
          useValue: verificationRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: {},
        },
        {
          provide: DuplicateDetectionService,
          useValue: duplicateDetectionService,
        },
        {
          provide: WebhooksService,
          useValue: webhooksService,
        },
        {
          provide: MetadataSchemaService,
          useValue: metadataSchemaService,
        },
        {
          provide: FilesService,
          useValue: filesService,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
        {
          provide: DataSource,
          useValue: {},
        },
        {
          provide: SorobanService,
          useValue: sorobanService,
        },
        {
          provide: IssuersService,
          useValue: issuersService,
        },
      ],
    }).compile();

    service = module.get<CertificateService>(CertificateService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should generate a QR code URL for a certificate', async () => {
    const certificate = {
      id: 'cert-123',
      verificationCode: 'AB12CD34',
    } as Certificate;

    jest.spyOnObject(service, 'findOne').mockResolved(certificate);
    const originalFrontendUrl = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://stellarcert.app';

    try {
      const result = await service.getCertificateQrCode('cert-123');

      expect(result).toEqual({
        id: 'cert-123',
        verificationCode: 'AB12CD34',
        verificationUrl: 'https://stellarcert.app/verify/AB12CD34',
        qrCode: expect.any(String),
      });
      expect(result.qrCode).toContain('data:image/png;base64,');
    } finally {
      if (originalFrontendUrl === undefined) {
        delete process.env.FRONTEND_URL;
      } else {
        process.env.FRONTEND_URL = originalFrontendUrl;
      }
    }
  });

  describe('findAll limit capping and scoping', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should cap limit at MAX_PAGE_LIMIT (100) when limit exceeds 100', async () => {
      await service.findAll(1, 250, 'issuer-1', 'active');

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_PAGE_LIMIT);
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.issuerId = :issuerId',
        { issuerId: 'issuer-1' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.status = :status',
        { status: 'active' },
      );
    });

    it('should use provided limit when within acceptable range', async () => {
      await service.findAll(2, 25);

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(25);
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(25);
    });
  });

  describe('exportCertificates scoping and limits', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should force non-admin issuer to their own currentUserId', async () => {
      await service.exportCertificates(
        'other-issuer-id',
        'active',
        undefined,
        'my-issuer-id',
        UserRole.ISSUER,
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.issuerId = :issuerId',
        { issuerId: 'my-issuer-id' },
      );
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_EXPORT_LIMIT);
    });

    it('should allow admin to export any issuer certificates', async () => {
      await service.exportCertificates(
        'other-issuer-id',
        'active',
        undefined,
        'admin-id',
        UserRole.ADMIN,
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.issuerId =:issuerId',
        { issuerId: 'other-issuer-id' },
      );
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_EXPORT_LIMIT);
    });

    it('should cap requested limit at MAX_EXPORT_LIMIT', async () => {
      await service.exportCertificates(
        undefined,
        undefined,
        5000,
        'admin-id',
        UserRole.ADMIN,
      );

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_EXPORT_LIMIT);
    });
  });

  describe('bulkExport scoping and limits', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockQueryBuilder.getMany.mockResolvedValue([
        {
          id: 'cert-1',
          recipientName: 'Alice',
          recipientEmail: 'alice@example.com',
          title: 'Cert 1',
          courseName: 'Course 1',
          issuedAt: new Date('2026-01-01'),
          status: 'active',
        },
      ]);
    });

    it('should force non-admin issuer to their own issuerId and filter certificates', async () => {
      await service.bulkExport(
        ['cert-1', 'cert-2'],
        { issuerId: 'attacker-target-id', status: 'active' },
        'my-issuer-id',
        UserRole.ISSUER,
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.issuerId = :issuerId',
        { issuerId: 'my-issuer-id' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.id IN (:..certificateIds)',
        { certificateIds: ['cert-1', 'cert-2'] },
      );
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_EXPORT_LIMIT);
    });

    it('should allow admin to filter by target issuerId', async () => {
      await service.bulkExport(
        [],
        { issuerId: 'target-issuer-id' },
        'target-issuer-id',
        UserRole.ADMIN,
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.issuerId =:issuerId',
        { issuerId: 'target-issuer-id' },
      );
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_EXPORT_LIMIT);
    });
  });

  describe('exportAllFiltered scoping and limits', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockQueryBuilder.getMany.mockResolvedValue([]);
    });

    it('should force non-admin issuer to their own issuerId', async () => {
      await service.exportAllFiltered(
        { issuerId: 'attacker-target-id', status: 'active' },
        'my-issuer-id',
        UserRole.ISSUER,
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.issuerId =:issuerId',
        { issuerId: 'my-issuer-id' },
      );
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_EXPORT_LIMIT);
    });

    it('should allow admin to export all certificates across issuers without issuerId filter', async () => {
      await service.exportAllFiltered(
        { status: 'active' },
        undefined,
        UserRole.ADMIN,
      );

      const calls = mockQueryBuilder.andWhere.mock.calls;
      const issuerCalls = calls.filter((c: any[]) => c[0].includes('issuerId'));
      expect(issuerCalls).toHaveLength(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_EXPORT_LIMIT);
    });
  });

  describe('issue (#incrementCertificateCount wiring)', () => {
    const issuerId = 'issuer-1';
    const dto = {
      issuerId: issuerId,
      recipientName: 'Alice',
      recipientEmail: 'alice@example.com',
      title: 'Cert 1',
      courseName: 'Course 1',
    } as any;

    beforeEach(() => {
      jest.clearAllMocks();
      sorobanService.isConfigured.mockReturnValue(false);
      certificateRepository.create.mockImplementation((e) => e);
      certificateRepository.save.mockImplementation((c) => Promise.resolve(c));
      certificateRepository.update.mockResolvedValue({ affected: 1 });
    });

    it('increments the issuer counter after a successful issue', async () => {
      await service.issue(dto);

      expect(issuersService.incrementCertificateCount).toHaveBeenCalledWith(issuerId);
    });

    it('does not increment the counter when issuance fails', async () => {
      certificateRepository.save.mockRejectedValue(new Error('db'));

      await expect(service.issue(dto)).rejects.toThrow('db');
      expect(issuersService.incrementCertificateCount).not.toHaveBeenCalled();
    });
  });

  describe('syncChain', () => {
    let certificate: Certificate;

    beforeEach(() => {
      jest.clearAllMocks();
      sorobanService.isConfigured.mockReturnValue(false);
      certificate = {
        id: 'cert-1',
        verificationCode: 'AB12CD34',
        issuerStellarAddress: 'GISSUER',
        recipientStellarAddress: 'GRECIPIENT',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        stellarTransactionHash: undefined,
      } as unknown as Certificate;
    });

    it('returns the existing hash without touching the chain when already synced', async () => {
      const synced = {
        ...certificate,
        stellarTransactionHash: 'abc123',
      } as unknown as Certificate;
      jest.spyOnObject(service, 'findOne').mockResolved(synced);

      const result = await service.syncChain('cert-1');

      expect(result).toEqual('abc123');
      expect(sorobanService.issueCertificate).not.toHaveBeenCalled();
    });
  });
});
