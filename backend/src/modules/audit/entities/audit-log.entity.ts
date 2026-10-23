import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { AuditAction, AuditResourceType } from '../constants';

/**
 * Retention / deletion semantics for audit evidence:
 * - Audit logs are immutable evidence and are not hard-deleted by user-initiated
 *   erasure requests.
 * - PII contained in audit records (userEmail, ipAddress, userAgent, resourceData,
 *   changes, metadata) is subject to anonymization once the retention window
 *   has elapsed and no legal hold applies.
 * - Anonymization is tracked via `anonymizedAt`, `retentionExpiresAt`, and
 *   `legalHoldId` so the workflow is auditable and idempotent.
 */
@Entity('audit_logs')
@Index(['userId'])
@Index(['action'])
@Index(['resourceType'])
// @Index(['resourceId']) // Keep commented for now
@Index(['timestamp'])
@Index(['correlationId'])
@Index(['ipAddress'])
@Index(['status'])
@Index(['legalHoldId'])
@Index(['anonymizedAt'])
@Index(['retentionExpiresAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: AuditAction,
    nullable: false,
  })
  action: AuditAction;

  @Column({
    type: 'enum',
    enum: AuditResourceType,
    nullable: false,
  })
  resourceType: AuditResourceType;

  // FIX: Add explicit type for resourceId
  @Column({
    nullable: true,
    type: 'varchar', // This tells TypeORM to use PostgreSQL VARCHAR
  })
  resourceId: string | null;

  @Column({
    type: 'jsonb',
    nullable: true,
  })
  resourceData: any;

  @Column({
    type: 'jsonb',
    nullable: true,
  })
  changes: {
    before?: any;
    after?: any;
  } | null;

  // Also fix userId for consistency
  @Column({
    nullable: true,
    type: 'varchar',
  })
  userId: string | null;

  @Column({
    nullable: true,
    type: 'varchar',
  })
  userEmail: string | null;

  @Column({
    nullable: true,
    type: 'varchar',
  })
  userRole: string | null;

  @Column({
    nullable: false,
    type: 'varchar',
  })
  ipAddress: string;

  @Column({
    nullable: true,
    type: 'varchar',
  })
  userAgent: string | null;

  @Column({
    nullable: true,
    type: 'varchar',
  })
  correlationId: string | null;

  @Column({
    nullable: true,
    type: 'varchar',
  })
  transactionHash: string | null;

  @Column({
    type: 'jsonb',
    nullable: true,
  })
  metadata: Record<string, any>;

  @Column({
    default: 'success',
    type: 'varchar',
  })
  status: 'success' | 'failure' | 'error';

  @Column({
    nullable: true,
    type: 'varchar',
  })
  errorMessage: string | null;

  @Column({
    type: 'bigint',
  })
  timestamp: number;

  // Note: `timestamp` is the hot column for search/sort/purge and is
  // indexed at the entity level above. `createdAt` is kept for data
  // compatibility but is no longer indexed.
  @CreateDateColumn()
  createdAt: Date;
}
