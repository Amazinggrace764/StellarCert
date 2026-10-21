import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  Between,
  In,
  Like,
  MoreThanOrEqual,
  LessThanOrEqual,
} from 'typeorm';
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
   * Redacts sensitive data from an object recursively
   */
  private redactSensitiveData(data: any): any {
    if (!data || typeof data !== 'object') {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.redactSensitiveData(item));
    }

    const sensitiveKeys = [
      'password',
      'token',
      'secret',
      'privateKey',
      'apiKey',
      'auth',
      'credential',
      'ssn',
      'creditCard',
      'email',
      'phone',
      'address',
      'dateOfBirth',
    ];

    const redacted = { ...data };

    for (const key of Object.keys(redacted)) {
      // Check if the key itself contains a sensitive string (case-insensitive)
      const isSensitive = sensitiveKeys.some((sk) =>
        key.toLowerCase().includes(sk.toLowerCase()),
      );

      if (isSensitive) {
        redacted[key] = '[REDACTED]';
      } else if (typeof redacted[key] === 'object') {
        redacted[key] = this.redactSensitiveData(redacted[key]);
      }
    }

    return redacted;
  }

  async search(
    searchDto: AuditSearchDto,
  ): Promise<{ data: AuditLog[]; total: number }> {
    const query = this.auditLogRepository.createQueryBuilder('audit');

    if (searchDto.action) {
      query.andWhere('audit.action = :action', { action: searchDto.action });
    }

    if (searchDto.resourceType) {
      query.andWhere('audit.resourceType = :resourceType', {
        resourceType: searchDto.resourceType,
      });
    }

    if (searchDto.userId) {
      query.andWhere('audit.userId = :userId', { userId: searchDto.userId });
    }

    if (searchDto.userEmail) {
      query.andWhere('audit.userEmail ILIKE :userEmail', {
        userEmail: `%${searchDto.userEmail}%`,
      });
    }

    if (searchDto.resourceId) {
      query.andWhere('audit.resourceId = :resourceId', {
        resourceId: searchDto.resourceId,
      });
    }

    if (searchDto.correlationId) {
      query.andWhere('audit.correlationId = :correlationId', {
        correlationId: searchDto.correlationId,
      });
    }

    if (searchDto.ipAddress) {
      query.andWhere('audit.ipAddress = :ipAddress', {
        ipAddress: searchDto.ipAddress,
      });
    }

    if (searchDto.status) {
      query.andWhere('audit.status = :status', { status: searchDto.status });
    }

    if (searchDto.startDate || searchDto.endDate) {
      const startTime = searchDto.startDate
        ? new Date(searchDto.startDate).getTime()
        : 0;
      const endTime = searchDto.endDate
        ? new Date(searchDto.endDate).getTime() + 86400000 // Add 24 hours for end of day
        : Date.now();

      query.andWhere('audit.timestamp BETWEEN :startTime AND :endTime', {
        startTime,
        endTime,
      });
    }

    query.orderBy('audit.timestamp', 'DESC');

    const skip = searchDto.skip || 0;
    const take = Math.min(searchDto.take || 50, 500); // Max 500 records per request

    query.skip(skip).take(take);

    const [data, total] = await query.getManyAndCount();

    return { data, total };
  }

  async getStatistics(
    filters?: Partial<AuditSearchDto>,
  ): Promise<AuditStatisticsDto> {
    const query = this.auditLogRepository.createQueryBuilder('audit');

    if (filters?.action) {
      query.andWhere('audit.action = :action', { action: filters.action });
    }

    if (filters?.resourceType) {
      query.andWhere('audit.resourceType = :resourceType', {
        resourceType: filters.resourceType,
      });
    }

    if (filters?.userId) {
      query.andWhere('audit.userId = :userId', { userId: filters.userId });
    }

    if (filters?.startDate || filters?.endDate) {
      const startTime = filters.startDate
        ? new Date(filters.startDate).getTime()
        : 0;
      const endTime = filters.endDate
        ? new Date(filters.endDate).getTime() + 86400000
        : Date.now();
      query.andWhere('audit.timestamp BETWEEN :startTime AND :endTime', {
        startTime,
        endTime,
      });
    }

    // Total events
    const totalEvents = await query.getCount();

    // Events by action
    const eventsByActionRaw = await query
      .select('audit.action', 'action')
      .addSelect('COUNT(*)', 'count')
      .groupBy('audit.action')
      .getRawMany();

    const eventsByAction = eventsByActionRaw.reduce(
      (acc, { action, count }) => {
        acc[action] = parseInt(count);
        return acc;
      },
      {} as Record<string, number>,
    );

    // Events by resource type
    const eventsByResourceTypeRaw = await query
      .select('audit.resourceType', 'resourceType')
      .addSelect('COUNT(*)', 'count')
      .groupBy('audit.resourceType')
      .getRawMany();

    const eventsByResourceType = eventsByResourceTypeRaw.reduce(
      (acc, { resourceType, count }) => {
        acc[resourceType] = parseInt(count);
        return acc;
      },
      {} as Record<string, number>,
    );

    // Events by status
    const eventsByStatusRaw = await query
      .select('audit.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('audit.status')
      .getRawMany();

    const eventsByStatus = eventsByStatusRaw.reduce(
      (acc, { status, count }) => {
        acc[status] = parseInt(count);
        return acc;
      },
      {} as Record<string, number>,
    );

    // Events per day
    const eventsPerDayRaw = await query
      .select('DATE(to_timestamp(audit.timestamp / 1000))', 'date')
      .addSelect('COUNT(*)', 'count')
      .groupBy('DATE(to_timestamp(audit.timestamp / 1000))')
      .orderBy('DATE(to_timestamp(audit.timestamp / 1000))', 'DESC')
      .limit(30)
      .getRawMany();

    const eventsPerDay = eventsPerDayRaw.reduce(
      (acc, { date, count }) => {
        acc[date] = parseInt(count);
        return acc;
      },
      {} as Record<string, number>,
    );

    // Top users
    const topUsersRaw = await query
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
      eventCount: parseInt(row.eventCount),
    }));

    // Top resources
    const topResourcesRaw = await query
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
      eventCount: parseInt(row.eventCount),
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

  /**
   * Purge audit logs older than the retention window. Respects legal holds.
   */
  async cleanupOldLogs(retentionDays: number): Promise<PurgeResult> {
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const result: PurgeResult = {
      deleted: 0,
      anonymized: 0,
      skippedHeld: 0,
      skippedRetained: 0,
      cutoffTime,
    };

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
