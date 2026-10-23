import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { CertificateSearchService, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './certificate-search.service';
import { Certificate } from '../entities/certificate.entity';

describe('CertificateSearchService', () => {
  let service: CertificateSearchService;

  const mockQueryBuilder = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolved(0),
    getMany: jest.fn().mockResolved([]),
    getOne: jest.fn().mockResolved(null),
  };

  const mockRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQueryBuilder.getCount.mockResolved(0);
    mockQueryBuilder.getMany.mockResolved([]);
    mockQueryBuilder.getOne.mockResolved(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificateSearchService,
        {
          provide: getRepositoryToken(Certificate),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<CertificateSearchService>(CertificateSearchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('escapeLikePattern', () => {
    it('leaves plain terms unchanged', () => {
      expect(escapeLikePattern('John')).toBe('John');
    });

    it('escapes percent, underscore and backslash', () => {
      expect(escapeLikePattern('100%_off\\test')).toBe('100\\%\\_off\\\\test');
    });

    it('escapes a lone wildcard term', () => {
      expect(escapeLikePattern('%')).toBe('\\%');
    });
  });

  describe('search', () => {
    it('uses case-insensitive ILIKE with escaped wildcards and parameter binding', () => {
      const query = "John'; DROP TABLE certificates; --";
      const filters = {
        issuerId: 'issuer-uuid-123',
        status: 'active',
        recipientEmail: 'user@example.com',
      };

      await service.search(query, filters);

      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith(
        'certificate',
      );
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'certificate.issuer',
        'issuer',
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        "(certificate.title ILIKE :query ESCAPE '\\\\' OR certificate.recipientName ILIKE :query ESCAPE '\\\\' OR certificate.recipientEmail ILIKE :query ESCAPE '\\\\')",
        { query: `%\\${query}%` },
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.issuerId = :issuerId',
        { issuerId: 'issuer-uuid-123' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.status = :status',
        { status: 'active' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.recipientEmail = :recipientEmail',
        { recipientEmail: 'user@example.com' },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'certificate.issuedAt',
        'DESC',
      );
    });

    it('applies default pagination and returns metadata', async () => {
      mockQueryBuilder.getCount.mockResolvedOnce(42);
      mockQueryBuilder.getMany.mockResolvedOnce([
        { id: 'cert-1' } as Certificate,
      ]);

      const result = await service.search('');

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(DEFAULT_PAGE_SIZE);
      expect(mockQueryBuilder.getCount).toHaveBeenCalled();
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
      expect(result).toEqual({
        certificates: [{ id: 'cert-1' }],
        total: 42,
        page: 1,
        limit: DEFAULT_PAGE_SIZE,
        hasMore: true,
      });
    });

    it('clamps requested page size to the hard maximum', async () => {
      await service.search('', {}, 1, MAX_PAGE_SIZE * 10);

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_PAGE_SIZE);
    });

    it('normalizes invalid page and limit values', async () => {
      await service.search('', {}, -5, 0);

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(DEFAULT_PAGE_SIZE);
    });

    it('applies offset for subsequent pages', async () => {
      await service.search('', {}, 3, 10);

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(20);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
    });
  });

  describe('findAll', () => {
    it('applies pagination and parameter-bound filters', async () => {
      await service.findAll(2, 25, 'issuer-1', 'active');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.issuerId = :issuerId',
        { issuerId: 'issuer-1' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.status = :status',
        { status: 'active' },
      );
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(25);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(25);
    });

    it('caps page size at the hard maximum', async () => {
      await service.findAll(1, MAX_PAGE_SIZE * 100);

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_PAGE_SIZE);
    });
  });

  describe('findOne', () => {
    it('uses bound parameter for id and returns certificate', async () => {
      const mockCert = { id: 'cert-1' } as Certificate;
      mockQueryBuilder.getOne.mockResolvedOnce(mockCert);

      const result = await service.findOne('cert-1');

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'certificate.id = :id',
        { id: 'cert-1' },
      );
      expect(result).toBe(mockCert);
    });

    it('throws NotFoundException when certificate is not found', async () => {
      mockQueryBuilder.getOne.mockResolvedOnce(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getCertificatesByRecipient', () => {
    it('uses bound parameter for recipient email and applies pagination', async () => {
      await service.getCertificatesByRecipient('test@example.com');

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'certificate.recipientEmail = :email',
        { email: 'test@example.com' },
      );
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(DEFAULT_PAGE_SIZE);
    });

    it('caps page size at the hard maximum', async () => {
      await service.getCertificatesByRecipient(
        'test@example.com',
        1,
        MAX_PAGE_SIZE * 100,
      );

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_PAGE_SIZE);
    });
  });

  describe('getCertificatesByIssuer', () => {
    it('uses bound parameter for issuerId and applies pagination', async () => {
      await service.getCertificatesByIssuer('issuer-uuid');

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'certificate.issuerId = :issuerId',
        { issuerId: 'issuer-uuid' },
      );
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(DEFAULT_PAGE_SIZE);
    });

    it('caps page size at the hard maximum', async () => {
      await service.getCertificatesByIssuer('Issuer-uuid', 1, MAX_PAGE_SIZE * 100);

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_PAGE_SIZE);
    });
  });

  describe('getDuplicateCertificates', () => {
    it('uses bound parameter for isDuplicate flag and applies pagination', async () => {
      await service.getDuplicateCertificates();

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'certificate.isDuplicate = :isDuplicate',
        { isDuplicate: true },
      );
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(DEFAULT_PAGE_SIZE);
    });

    it('caps page size at the hard maximum', async () => {
      await service.getDuplicateCertificates(1, MAX_PAGE_SIZE * 100);

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_PAGE_SIZE);
    });
  });

  describe('exportCertificatesStream', () => {
    it('applies parameter-bound filters and streams rows in batches', async () => {
      const batch1 = [{ id: 'cert-1' }, { id: 'cert-2' }] as Certificate[];
      mockQueryBuilder.getMany
        .mockResolvedOnce(batch1)
        .mockResolvedOnce([]);

      const collected: Certificate[] = [];
      for await (const row of service.exportCertificatesStream('issuer-id', 'revoked')) {
        collected.push(row);
      }

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.issuerId = :issuerId',
        { issuerId: 'issuer-id' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'certificate.status = :status',
        { status: 'revoked' },
      );
      expect(collected.map((r) => r.id)).toEqual(['cert-1', 'cert-2']);
    });

    it('respects the hard maximum batch size', async () => {
      mockQueryBuilder.getMany.mockResolvedOnce([]);

      const iterator = service.exportCertificatesStream(undefined, undefined, MAX_PAGE_SIZE * 10);
      await iterator.next();

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(MAX_PAGE_SIZE);
    });
  });

  describe('exportCertificates', () => {
    it('truncates the collected result at MAX_PAGE_SIZE', async () => {
      const fullBatch = Array.from({ length: MAX_PAGE_SIZE }, (_, i) => ({
        id: `cert-${i}`,
      })) as Certificate[];
      mockQueryBuilder.getMany.mockResolved(fullBatch);

      const result = await service.exportCertificates();

      expect(result.length).toBe(
        MAX_PAGE_SIZE,
      );
    });
  });
});
