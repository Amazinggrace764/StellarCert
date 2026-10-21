import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AdminAnalyticsService } from './admin-analytics.service';
import { User } from '../../users/entities/user.entity';
import { Certificate } from '../../certificate/entities/certificate.entity';
import { Verification } from '../../certificate/entities/verification.entity';
import { Issuer } from '../../issuers/entities/issuer.entity';
import { CertificateStatsService } from '../../certificate/services/stats.service';
import { UserRole } from '../../../common/constants/roles';

/**
 * Minimal chainable query-builder stub: every builder call returns the builder,
 * and the terminal calls resolve to empty results.
 */
function queryBuilderStub() {
  const qb: Record<string, jest.Mock> = {};
  for (const method of [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'groupBy',
    'orderBy',
    'leftJoinAndSelect',
  ]) {
    qb[method] = jest.fn(() => qb);
  }
  qb.getRawMany = jest.fn(async () => []);
  qb.getCount = jest.fn();
  qb.getCount.mockResolved(0);
  qb.getOne = jest.fn(async () => null);
  return qb;
}

describe('AdminAnalyticsService', () => {
  const CACHE_TTL_MS = 2 * 60 * 1000;
  const cacheManager = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };
  const certificateStatsService = {
    getTopIssuersData: jest.fn(async () => []),
  };

  let service: AdminAnalyticsService;
  let userRepository: { count: jest.Mock; createQueryBuilder: jest.Mock };

  const repositoryStub = () => ({
    count: jest.fn(async () => 0),
    createQueryBuilder: jest.fn(() => queryBuilderStub()),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    cacheManager.get.mockResolved(undefined);
    userRepository = repositoryStub();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAnalyticsService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: getRepositoryToken(Certificate), useValue: repositoryStub() },
        {
          provide: getRepositoryToken(Verification),
          useValue: repositoryStub(),
        },
        { provide: getRepositoryToken(Issuer), useValue: repositoryStub() },
        { provide: CACHE_MANAGER, useValue: cacheManager },
        { provide: CertificateStatsService, useValue: certificateStatsService },
      ],
    }).compile();

    service = module.get<AdminAnalyticsService>(AdminAnalyticsService);
  });

  describe('cache TLL unit (#731)', () => {
    it('caches analytics for 2 minutes expressed in milliseconds', async () => {
      await service.getAnalytics({});

      expect(cacheManager.set).toHaveBeenCalledTimes(1);
      const [key, , ttl] = cacheManager.set.mock.calls[0];
      expect(key).toBe('admin-analytics');
      // 120_000 ms = 2 minutes. A seconds value (120) would expire almost
      // immediately; a seconds value multiplied by 1000 (120_000 seconds)
      // would live for ~33 hours.
      expect(ttl).toBe(CACHE_TTL_MS);
      expect(ttl).toBe(120_000);
    });

    it('returns the cached payload without recomputing', async () => {
      const cached = { totalIssuers: 7 };
      cacheManager.get.mockResolved(cached);

      const result = await service.getAnalytics({});

      expect(result).toBe(cached);
      expect(cacheManager.set).not.toHaveBeenCalled();
    });
  });

  describe('getUsersBullRole covers every UserRole enum value', () => {
    it('queries all roles defined in the UserRole enum', async () => {
      await service.getAnalytics({});

      const allRoles = Object.values(UserRole);
      const queriedRoles = userRepository.count.mock.calls.map(
        (call) => call[0]?.where?.role,
      );
      for (const role of allRoles) {
        expect(queriedRoles).toContain(role);
      }
      expect(queriedRoles).toHaveLength(allRoles.length);
    });

    it('reports RECIPIENT, VERIFIER and AUDITOR counts in the distribution', async () => {
      const countsByRole: Record<string, number> = {
        [UserRole.USER]: 10,
        [UserRole.ISSUER]: 4,
        [UserRole.ADMIN]: 2,
        [UserRole.RECIPIENT]: 7,
        [UserRole.VERIFIER]: 3,
        [UserRole.AUDITOR]: 1,
      };
      userRepository.count.mockImplementation(async (args: any) =>
        countsByRole[args.where.role] ?? 0,
      );

      const result = await service.getAnalytics({});

      expect(result.usersByRole).toMatchObject({
        users: 10,
        issuers: 4,
        admins: 2,
        recipients: 7,
        verifiers: 3,
        auditors: 1,
        total: 27,
      });
    });

    it('returns zero for roles with no users and keeps total consistent', async () => {
      userRepository.count.mockImplementation(async (args: any) =>
        args.where.role === UserRole.USER ? 5 : 0,
      );

      const result = await service.getAnalytics({});

      expect(result.usersByRole).toMatchObject({
        users: 5,
        issuers: 0,
        admins: 0,
        recipients: 0,
        verifiers: 0,
        auditors: 0,
        total: 5,
      });
    });
  });
});
