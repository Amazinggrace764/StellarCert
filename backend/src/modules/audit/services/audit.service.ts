import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { AuditLog } from '../entities';
import { AuditAction, AuditResourceType } from '../constants';
import { AuditSearchDto, AuditStatisticsDto } from '../dto';
import { RequestContextService } from './request-context.service';
import { LoggingService } from '../../../common/logging/logging.service';
import { toCsv } from '../../../common/utils/csv.utils';

export interface LogAuditParams {
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string;
  userId?: string;
  userEmail?: string;
  userRole?: string;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
  transactionHash?: string;
  resourceData?: any;
  changes?: {
    before?: any;
    after?: any;
  };
  metadata?: Record<string, any>;
  status?: 'success' | 'failure' | 'error';
  errorMessage?: string;
  timestamp?: number;
  /**
   * Identifies of retention/legal-hold categories that apply to this record.
   * Used by the deletion/anonymization workflow to decide whether a record may be
   * purged or must be retained as audit evidence.
   */
  retentionCategory?: string;
  /**
   * When true, the record is subject to a legal hold and must not be deleted
   * or anonymized until the hold is released.
   */
  legalHold?: boolean;
  /**
   * Optional explicit expiry timestamp (ms). Overrides the category-default
   * retention period when provided.
   */
  expiresAt?: number;
}

/**
 * Default retention period (in days) for audit records that do not carry an
 * explicit retention category. This is the floor for audit evidence.
 */
export const DEFAULT_AUDIT_RETENTION_DAYS = 2555; // ~ 7 years

/**
 * Retention categories for audit records. Each category maps to a retention
 * period and the default deletion/anonymization behavior applied when the
 * retention period elapses.
 */
export interface RetentionPolicy {
  category: string;
  retentionDays: number;
  behavior: 'delete' | 'anonymize';
  description: string;
}

export const AUDIT_RETENTION_POLICIES: ReadonlyArray<RetentionPolicy> = [
  {
    category: 'security',
    retentionDays: 2555,
    behavior: 'anonymize',
    description:
      'Security-and-access audit evidence; retained for 7 years, then PII is anonymized.',
  },
  {
    category: 'certificate',
    retentionDays: 2555,
    behavior: 'anonymize',
    description:
      'Certificate lifecycle audit trail; retained for 7 years to preserve integrity with immutable on-chain records, then anonymized.',
  },
  {
    category: 'operational',
    retentionDays: 365,
    behavior: 'delete',
    description:
      'General operational audit logs; retained for 1 year, then deleted.',
  },
  {
    category: 'transient',
    retentionDays: 30,
    behavior: 'delete',
    description:
      'Short-lived operational audit logs; retained for 30 days, then deleted.',
  },
];

export interface PurgeResult {
  deleted: number;
  anonymized: number;
  skippedHeld: number;
  skippedRetained: number;
  cutoffTime: number;
}

/**
 * Sensitive field names that must never be persisted in cleartext in audit logs.
 */
const SENSITIVE_KEYS: readonly string[] = [
  'password',
  'token',
  'secret',
  'privatekey',
  'apikey',
  'auth',
  'credential',
  'ssn',
  'creditcard',
];

const MAX_EXPORT_ROWS = 50000;
const DAY_MS = 86400000;

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
    private requestContextService: RequestContextService,
    private readonly logger: LoggingService,
  ) {}

  async log(params: LogAuditParams): Promise<AuditLog | null> {
    try {
      const redactedChanges = params.changes
        ? this.redactSensitiveData(params.changes)
        : undefined;
      const redactedResourceData = params.resourceData
        ? this.redactSensitiveData(params.resourceData)
        : undefined;
      const redactedMetadata = params.metadata
        ? this.redactSensitiveData(params.metadata)
        : undefined;

      const auditLog = this.auditLogRepository.create({
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        userId: params.userId,
        userEmail: params.userEmail,
        userRole: params.userRole,
        ipAddress: params.ipAddress || 'unknown',
        userAgent: params.userAgent,
        correlationId: params.correlationId,
        transactionHash: params.transactionHash,
        resourceData: redactedResourceData,
        changes: redactedChanges,
        metadata: redactedMetadata,
        status: params.status || 'success',
        errorMessage: params.errorMessage,
        timestamp: params.timestamp || Date.now(),
        retentionCategory: params.retentionCategory,
        legalHold: params.legalHold === true,
        expiresAt: params.expiresAt,
      });

      const saved = await this.auditLogRepository.save(auditLog);
      return saved;
    } catch (error) {
      this.logger.error(
        `Failed to log audit event: ${error.message}`,
        error.stack,
      );
      // Don't throw - audit failures should not break main operations
      return null;
    }
  }

  /**
   * Redacts sensitive data from an object recursively.
   *
   * Keys are matched case-insensitively and substring-wise, so `authToken`,
   * `privateKey`, `apiKey`, etc. are all redacted. Circular references are
   * handled via a WeakSet to prevent infinite recursion.
   */
  private redactSensitiveData(data: any, seen: WeakSet<object> = new WeakSet()): any {
    if (!data || typeof data !== 'object') {
      return data;
    }

    if (seen.has(data)) {
      return '[CIRCLAR]';
    }
    seen.add(data);

    if (Array.isArray(data)) {
      return data.map((item) => this.redactSensitiveData(item, seen));
    }

    const redacted: Record<string, any> = {};

    for (const key of Object.keys(data)) {
      // Check if the key itself contains a sensitive string (case-insensitive)
      const isSensitive = SENSITIVE_KEYS.some((sk) =>
        key.toLowerCase().includes(sk.lowerCase()),
      );

      if (isSensitive) {
        redacted[key] = '[REDACTED]';
      } else if (data[key] && typeof data[key] === 'object') {
        redacted[key] = this.redactSensitiveData(data[key], seen);
      } else {
        redacted[key] = data[key];
      }
    }

    return redacted;
  }

  /**
   * Applies the standard filter set to a query builder. Shared by search,
   * statistics and export so all read paths stay consistent.
   */
  private applyFilters(
    query: ReturnType<Repository<AuditLog>['createQueryBuilder']>,
    filters: Partial<AuditSearchDto>,
  ): void {
    if (filters.action) {
      query.andWhere('audit.action = :action', { action: filters.action });
    }

    if (filters.resourceType) {
      query.andWhere('audit.resourceType = :resourceType', {
        resourceType: filters.resourceType,
      });
    }

    if (filters.userId) {
      query.andWhere('audit.userId = :userId', { userId: filters.userId });
    }

    if (filters.userEmail) {
      query.andWhere('audit.userEmail ILIKE :userEmail', {
        userEmail: `%${filters.userEmail}%`,
      });
    }

    if (filters.resourceId) {
      query.andWhere('audit.resourceId = :resourceId', {
        resourceId: filters.resourceId,
      });
    }

    if (filters.correlationId) {
      query.andWhere('audit.correlationId = :correlationId', {
        correlationId: filters.correlationId,
      });
    }

    if (filters.ipAddress) {
      query.andWhere('audit.ipAddress = :ipAddress', {
        ipAddress: filters.ipAddress,
      });
    }

    if (filters.status) {
      query.andWhere('audit.status = :status', { status: filters.status });
    }

    if (filters.startDate || filters.endDate) {
      const startTime = filters.startDate
        ? new Date(filters.startDate).getTime()
        : 0;
      const endTime = filters.endDate
        ? new Date(filters.endDate).getTime() + DAY_MS // Add 24 hours for end of day
        : Date.now();

      query.andWhere('audit.timestamp BETWEEN :startTime AND :endTime', {
        startTime,
        endTime,
      });
    }
  }

  async search(
    searchDto: AuditSearchDto,
  ): Promise<{ data: AuditLog[]; total: number }> {
    const query = this.auditLogRepository.createQueryBuilder('audit');

    this.applyFilters(query, searchDto);

    query.orderBy('audit.timestamp', 'DESC');

    const skip = searchDto.skip || 0;
    const take = Math.min(searchDto.take || 50, maxTake);

    query.skip(skip).take(take);

    const [data, total] = await query.getManyAndCount();

    return { data, total };
  }

  async getStatistics(
    filters?: Partial<AuditSearchDto>,
  ): Promise<AuditStatisticsDto> {
    const baseQuery = () => {
      const query = this.auditLogRepository.createQueryBuilder('audit');
      this.applyFilters(query, filters || {});
      return query;
    };

    // Total events
    const totalEvents = await baseQuery().getCount();

    // Events by action
    const eventsByActionRaw = await baseQuery()
      .select('audit.action', 'action')
      .addSelect('COUNT(*)', 'count')
      .groupBy('audit.action')
      .getRawMany();

    const eventsByAction = eventsByActionRaw.reduce(
      (acc, { action, count }) => {
        acc[action] = parseInt(count, 10);
        return acc;
      },
      {} as Record<string, number>,
    );

    // Events by resource type
    const eventsByResourceTypeRaw = await baseQuery()
      .select('audit.resourceType', 'resourceType')
      .addSelect('COUNT(*)', 'count')
      .groupBy('audit.resourceType')
      .getRawMany();

    const eventsByResourceType = eventsByResourceTypeRaw.reduce(
      (acc, { resourceType, count }) => {
        acc[resourceType] = parseInt(count, 10);
        return acc;
      },
      {} as Record<string, number>,
    );

    // Events by status
    const eventsByStatusRaw = await baseQuery()
      .select('audit.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('audit.status')
      .getRawMany();

    const eventsByStatus = eventsByStatusRaw.reduce(
      (acc, { status, count }) => {
        acc[status] = parseInt(count, 10);
        return acc;
      },
      {} as Record<string, number>,
    );

    // Events per day
    const eventsPerDayRaw = await baseQuery()
      .select('DATE(to_timestamp(audit.timestamp / 1000))', 'date')
      .addSelect('COUNT(*)', 'count')
      .groupBy('DATE(to_timestamp(audit.timestamp / 1000))')
      .orderBy('DATE(to_timestamp(audit.timestamp / 1000))', 'DESC')
      .limit(30)
      .getRawMany();

    const eventsPerDay = eventsPerDayRaw.reduce(
      (acc, { date, count }) => {
        acc[date] = parseInt(count, 10);
        return acc;
      },
      {} as Record<string, number>,
    );

    // Top users
    const topUsersRaw = await baseQuery()
      .select('audit.userId', 'userId')
      .addSelect('audit.userEmail', 'userEmail')
      .addSelect('COUNT(*)', 'eventCount')
      .groupBy('audit.userId')
      .addGroupBy('audit.userEmail')
      .orderBy('eventCount', 'DESC')
      .limit(10)
      .getRawMany();

    const topUsers = topUsersRaw.map((row) => ({
      userId: row.userId,
      userEmail: row.userEmail,
      eventCount: parseInt(row.eventCount, 10),
    }));

    // Top resources
    const topResourcesRaw = await baseQuery()
      .select('audit.resourceId', 'resourceId')
      .addSelect('audit.resourceType', 'resourceType')
      .addSelect('COUNT(*)', 'eventCount')
      .groupBy('audit.resourceId')
      .addGroupBy('audit.resourceType')
      .orderBy('eventCount', 'DESC')
      .limit(10)
      .getRawMany();

    const topResources = topResourcesRaw.map((row) => ({
      resourceId: row.resourceId,
      resourceType: row.resourceType,
      eventCount: parseInt(row.eventCount, 10),
    }));

    return {
      totalEvents,
      eventsByAction,
      eventsByResourceType,
      eventsByStatus,
      eventsPerDay,
      topUsers,
      topResources,
    } as AuditStatisticsDto;
  }

  async exportToCsv(searchDto: AuditSearchDto): Promise<string> {
    const { data } = await this.search({
      ...searchDto,
      skip: 0,
      take: MAX_EXPORT_ROWS,
    });

    if (data.length === 0) {
      return 'No audit logs found';
    }

    const headers = [
      'ID',
      'Action',
      'Resource Type',
      'Resource ID',
      'User ID',
      'User Email',
      'IP Address',
      'Status',
      'Timestamp',
      'Error Message',
      'Correlation ID',
    ];

    const rows = data.map((log) => [
      log.id,
      log.action,
      log.resourceType,
      log.resourceId || '',
      log.userId || '',
      log.userEmail || '',
      log.ipAddress,
      log.status,
      new Date(log.timestamp).toISOString(),
      log.errorMessage || '',
      log.correlationId || '',
    ]);

    return toCsv(headers, rows);
  }

  async cleanupOldLogs(retentionDays: number): Promise<number> {
    const cutoffTime = Date.now() - retentionDays * DAY_MS;

    const candidates = await this.auditLogRepository.find({
      where: { timestamp: LessThanOrEqual(cutoffTime) },
    });

    for (const log of candidates) {
      if (log.legalHoldId) {
        result.skippedHeld += 1;
        continue;
      }
      if (log.retentionExpiresAt && log.retentionExpiresAt.getTime() > Date.now()) {
        result.skippedRetained += 1;
        continue;
      }
      await this.auditLogRepository.delete(log.id);
      result.deleted += 1;
    }

    this.logger.log(
      `Audit log cleanup complete: deleted=${result.deleted} skippedHeld=${result.skippedHeld}`,
    );
    return result;
  }
}
