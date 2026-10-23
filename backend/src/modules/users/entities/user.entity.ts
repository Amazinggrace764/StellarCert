import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { UserRole } from '../../../common/constants/roles';

export { UserRole };

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
  PENDING_VERIFICATION = 'pending_verification',
}

/**
 * Lifecycle state for PII retention and deletion guarantees.
 * This is the authoritative marker for whether a user's personal data
 * has been anonymized or scheduled for erasure. It is intentionally
 * separate from UserStatus (account access state) so that audit and
 * legal-hold workflows can track data lifecycle independently of login.
 */
export enum UserDataLifecycleState {
  /** Active personal data is stored and may be processed. */
  ACTIVE = 'active',
  /** Deletion requested; workflow is propagating to replicas. */
  PENDING_DELETION = 'pending_deletion',
  /** PII has been anonymized; immutable audit/chain references remain. */
  ANONYMIZED = 'anonymized',
  /** Deletion is blocked by an active legal hold. */
  LEGALHOLD_HOLD = 'legal_hold',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  @Index()
  email: string;

  @Column({ nullable: true })
  username: string;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @Column({ select: false })
  password: string;

  @Column({ nullable: true })
  phone: string;

  // Stores the S3 object key (not a pre-signed URL). URLs are generated on-demand.
  // This key is a replica of PII reference and must be deleted by the
  // retention workflow when the owning user is anonymized.
  @Column({ nullable: true })
  profilePicture: string;

  @Column( {
    type: 'enum',
    enum: UserRole,
    default: UserRole.USER,
  })
  role: UserRole;

  @Column( {
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.PENDING_VERIFICATION,
  })
  status: UserStatus;

  // Lifecycle marker for PII retention/deletion guarantees.
  @Column({
    type: 'enum',
    enum: UserDataLifecycleState,
    default: UserDataLifecycleState.ACTIVE,
  })
  @Index()
  dataLifecycleState: UserDataLifecycleState;

  // Timestamp when the data-deletion workflow was requested. Used for SLA
  // tracking and idempotent reprocessing.
  @Column({ type: 'timestamp', nullable: true })
  dataDeletionRequestedAt: Date | null;

  // Timestamp when anonymization completed across all replicas.
  @Column({ type: 'timestamp', nullable: true })
  dataAnonymizedAt: Date | null;

  // Active legal hold blocks deletion/anonymization. Null means no hold.
  @Column({ type: 'timestamp', nullable: true })
  legalHoldUntil: Date | null;

  @Column({ type: 'varchar', nullable: true })
  legalHoldReason: string | null;

  // Opaque reference to the audit record that authorized the last
  // deletion/anonymization action. Never contains PII itself.
  @Column({ type: 'varchar', nullable: true })
  dataDeletionAuditId: string | null;

  // Idempotency key for the deletion workflow. Repeated requests with the
  // same key are noops.
  @Column({ type: 'varchar', nullable: true })
  @Index()
  dataDeletionIdempotencyKey: string | null;

  @Column({ nullable: true, unique: true })
  @Index()
  stellarPublicKey: string;

  @Column({ default: false })
  isEmailVerified: boolean;

  @Column({ nullable: true })
  emailVerificationToken: string;

  @Column({ type: 'timestamp', nullable: true })
  emailVerificationExpires: Date;

  @Column({ nullable: true })
  passwordResetToken: string;

  @Column({ nullable: true })
  @Index()
  passwordResetTokenHash: string;

  @Column({ type: 'timestamp', nullable: true })
  passwordResetExpires: Date;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ default: 0 })
  loginAttempts: number;

  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  lockedUntil: Date;

  @Column({ type: 'varchar', nullable: true })
  refreshToken: string | null;

  @Column({ type: 'timestamp', nullable: true })
  refreshTokenExpires: Date | null;

  @Column({ default: false })
  twoFactorEnabled: boolean;

  @Column({ type: 'varchar', nullable: true, select: false })
  twoFactorSecret: string | null;

  @Column({ type: 'simple-array', nullable: true, select: false })
  twoFactorBackupCodes: string[] | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Virtual property for full name
  get fullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }

  // Check if account is locked
  isLocked(): boolean {
    if (!this.lockedUntil) return false;
    return new Date() < this.lockedUntil;
  }

  // Check if email verification token is valid
  isEmailVerificationTokenValid(): boolean {
    if (!this.emailVerificationToken || !this.emailVerificationExpires) {
      return false;
    }
    return new Date() < this.emailVerificationExpires;
  }

  // Check if password reset token is valid
  isPasswordResetTokenValid(): boolean {
    if (!this.passwordResetToken || !this.passwordResetExpires) {
      return false;
    }
    return new Date() < this.passwordResetExpires;
  }

  // Returns true when an active legal hold blocks deletion or anonymization.
  isUnderLegalHold(): boolean {
    if (!this.legalHoldUntil) return false;
    return new Date() < this.legalHoldUntil;
  }

  // Returns true when the record has already been anonymized.
  isAnonymized(): boolean {
    return this.dataLifecycleState === UserDataLifecycleState.ANONYMIZED;
  }

  // Returns true when deletion may proceed for this record.
  canBeDeleted(): boolean {
    return !this.isUnderLegalHold() && !this.isAnonymized();
  }
}
