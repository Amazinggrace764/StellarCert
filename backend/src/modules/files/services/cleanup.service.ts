import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs'; import * as path from 'path';
import { promisify } from 'util';
import { LoggingService } from '../../../common/logging/logging.service';
import { DistributedLockService } from '../../../common/services/distributed-lock.service';

const TEMP_FILE_CLEANUP_LOCK = 'stellar-cert:cron:temp-file-cleanup';

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);

/**
 * Retention policy for temporary files that may contain certificate-related PII
 * (uploaded certificate documents, staging copies, exports).
 *
 * - Temp files are treated as ephemeral copies of PII and are deleted after a
 *   short retention window (default 24 hours).
 * - Deletion is idempotent: re-running the job is safe, and already-removed
 *   files are ignored.
 * - Every deletion is audited through the structured logging service with the
 *   file name and age, without logging file contents.
 * - A distributed lock prevents concurrent deletions across instances.
 */
@Injectable()
export class CleanupService {
  private readonly tempDir = path.join(process.cwd(), 'temp');
  private readonly retentionMs = 24 * 60 * 60 * 1000;

  constructor(
    private readonly logger: LoggingService,
    private readonly distributedLock: DistributedLockService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCleanup() {
    const lockToken = await this.distributedLock.acquire(
      TEMP_FILE_CLEANUP_LOCK,
    );
    if (!lockToken) {
      this.logger.log(
        'Skipping temp file cleanup job; another instance owns the lock',
      );
      return;
    }

    try {
      this.logger.log('Running cleanup job for temp files...');

      if (!fs.existsSync(this.tempDir)) {
        return;
      }

      try {
        const files = await readdir(this.tempDir);
        const now = Date.now();

        for (const file of files) {
          const filePath = path.join(this.tempDir, file);
          const stats = await stat(filePath);

          if (!stats.isFile()) {
            continue;
          }

          const ageMs = now - stats.mtimeMs;
          if (ageMs > this.retentionMs) {
            try {
              await unlink(filePath);
              this.logger.log(
                `Audit: deleted temp file ${file} aged ${Math.round(ageMs / 1000)}s as part of PII retention policy`,
              );
            } catch (error) {
              if ((error as NodeJS.ErrnoSystemError).code === 'ENOENT') {
                // Idempotent: file already removed by another process.
                continue;
              }
              throw error;
            }
          }
        }
      } catch (error) {
        this.logger.error(
          `Error during cleanup: ${(error as Error).message}`,
          (error as Error).stack,
        );
      }
    } finally {
      await this.distributedLock.release(TEMP_FILE_CLEANUP_LOCK, lockToken);
    }
  }
}
