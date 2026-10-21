import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Job, Queue } from 'Bull';
import { SendCertificateIssuedDto } from './dto/send-certificate-issued.dto';
import { SendVerificationDto } from './dto/send-verification.dto';
import { SendPasswordResetDto } from './dto/send-password-reset.dto';
import { SendRevocationNoticeDto } from './dto/send-revocation-notice.dto';
import { EMAIL_QUEUE_NAME, EmailJobType } from './email-queue.processor';
import { LoggingService } from '../../common/logging/logging.service';

/**
 * Retention and deletion guarantees for email job payloads.
 *
 * Email jobs carry certificate-related PII (email addresses, recipient
 * names, certificate identifiers). To minimize retention we do the following:
 *  - Completed jobs are removed immediately (content is not kept in Redis).
 *  - Failed jobs are retained only for a bounded window so operators
 *    can diagnose delivery failures, then evicted by the queue retention
 *    policy.
 *  - Every job is tagged with a subject reference so account deletion /
 *    anonymization can find and purge queued replicas of that subject's data.
 *  - Payloads are never logged; only job identifiers and metadata are.
 */
export const EMAIL_JOB_RETENTION_SECONDS = 7 * 24 * 60 * 60; // 7 days

export const EMAIL_JOB_KEEP_FAILED = 1000;
export const EMAIL_JOB_KEEP_COMPLETED = 0;

export interface EmailJobRetentionOptions {
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  removeOnComplete: boolean | number;
  removeOnFail: boolean | number;
  jobId?: string;
}

type PiiReference = {
  subjectId?: string;
  certificateId?: string;
};

@Injectable()
export class EmailQueueService {
  constructor(
    @InjectQueue(EMAIL_QUEUE_NAME) private emailQueue: Queue,
    private readonly logger: LoggingService,
  ) {}

  private retentionOptions(pii: PiiReference): EmailJobRetentionOptions {
    const options: EmailJobRetentionOptions = {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      // Successful jobs hold PII in Redis; drop them immediately.
      removeOnComplete: true,
      // Failed jobs are retained for a bounded number of entries for debugging.
      removeOnFail: EMAIL_JOB_KEEP_FAILED,
    };

    // Deterministic job id per subject/certificate allows idempotent enqueuing
    // and targeted purge during account deletion / anonymization.
    if (pii.subjectId) {
      options.jobId = `email:${pii.subjectId}:${pii.certificateId ?? 'none'}`;
    }

    return options;
  }

  async queueCertificateIssued(dto: SendCertificateIssuedDto): Promise<void> {
    try {
      const job = await this.emailQueue.add(
        EmailJobType.SEND_CERTIFICATE_ISSUED,
        dto,
        this.retentionOptions({
          subjectId: (dto as unknown as { subjectId?: string }).subjectId,
          certificateId: (dto as unknown as { certificateId?: string }).certificateId,
        }),
      );
      this.logger.log(`Queued certificate issued email job: ${job.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to queue certificate issued email: ${error.message}`,
      );
      throw error;
    }
  }

  async queueVerificationEmail(dto: SendVerificationDto): Promise<void> {
    try {
      const job = await this.emailQueue.add(
        EmailJobType.SEND_VERIFICATION,
        dto,
        this.retentionOptions({
          subjectId: (dto as unknown as { subjectId?: string }).subjectId,
        }),
      );
      this.logger.log(`Queued verification email job: ${job.id}`);
    } catch (error) {
      this.logger.error(`Failed to queue verification email: ${error.message}`);
      throw error;
    }
  }

  async queuePasswordReset(dto: SendPasswordResetDto): Promise<void> {
    try {
      const job = await this.emailQueue.add(
        EmailJobType.SEND_PASSWORD_RESET,
        dto,
        this.retentionOptions({
          subjectId: (dto as unknown as { subjectId?: string }).subjectId,
        }),
      );
      this.logger.log(`Queued password reset email job: ${job.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to queue password reset email: ${error.message}`,
      );
      throw error;
    }
  }

  async queueRevocationNotice(dto: SendRevocationNoticeDto): Promise<void> {
    try {
      const job = await this.emailQueue.add(
        EmailJobType.SEND_REVOCATION,
        dto,
        this.retentionOptions({
          subjectId: (dto as unknown as { subjectId?: string }).subjectId,
          certificateId: (dto as unknown as { certificateId?: string }).certificateId,
        }),
      );
      this.logger.log(`Queued revocation notice email job: ${job.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to queue revocation notice email: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Purge all jobs that reference the given subject. Used by the account
   * deletion / anonymization workflow to remove queued replicas of PII.
   * Idempotent: repeated calls for an already-purged subject return 0.
   */
  async purgeSubjectJobs(subjectId: string): Promise<number> {
    if (!subjectId) {
      throw new Error('subjectId is required to purge email jobs');
    }

    const jobs: Job[] = await this.emailQueue.getJobs([
      'active',
      'delayed',
      'waiting',
      'failed',
      'completed',
    ]);

    const matched = jobs.filter((job) => {
      const data = job.data as unknown as { subjectId?: string };
      return data.subjectId === subjectId;
    });

    await Promise.all(matched.map((job) => job.remove()));

    this.logger.log(
      `Purged email jobs for subject ${subjectId}: ${matched.length}`,
    );

    return matched.length;
  }

  /**
   * Ensure the queue enforces the configured retention policy. Called at
   * startup and by operational jobs so retention drift is corrected.
   */
  async enforceRetentionPolicy(): Promise<void> {
    await this.emailQueue.clean(EMAIL_JOB_RETENTION_SECONDS, 'failed');
    await this.emailQueue.clean(EMAIL_JOB_RETENTION_SECONDS, 'completed');
    this.logger.log('Enforced email job retention policy');
  }

  async getQueueStats(): Promise<{
    active: number;
    delayed: number;
    failed: number;
    completed: number;
  }> {
    const active = await this.emailQueue.getActiveCount();
    const delayed = await this.emailQueue.getDelayedCount();
    const failed = await this.emailQueue.getFailedCount();
    const completed = await this.emailQueue.getCompletedCount();

    return { active, delayed, failed, completed };
  }
}
