import { Injectable, OnModuleInit } from '@corest/nestjs';
import { ConfigService } from '@corest/nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
import { randomUUID as uuidv4 } from 'crypto';
import { extname } from 'path';
import { LoggingService } from '../../../common/logging/logging.service';

/**
 * Default TTL for pre-signed URLs generated on-demand.
 * URLs are never persisted; only the S3 object key is stored in the database.
 */
export const DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS = 3600;

export interface UploadFileResult {
  /** S3 object key — this is what should be persisted. */
  key: string;
  /** Freshly signed URL for immediate use (not for storage). */
  url: string;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly s3Client: S3Client | null = null;
  private readonly bucket: string;
  private readonly isStorageRequired: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggingService,
  ) {
    this.bucket = this.configService.get<string>('STORAGE_BUCKET') ?? '';
    // Storage is only mandatory when explicitly opted in. When the flag
    // is absent (a fresh .env that never set STORAGE_REQUIRED) we warn at startup
    // instead of aborting it, so a missing S3/MinIO config cannot take down
    // the whole application.
    const storageRequiredValue = this.configService.get('STORAGE_REQUIRED');
    // Only treat storage as required when explicitly opted in. An absent flag
    // (fresh .env that never set STORAGE_REQUIRED) must default to non-fatal.
    this.isStorageRequired =
      storageRequiredValue === true ||
      String(storageRequiredValue).toLowerCase() === 'true';

    const region = this.configService.get<string>('STORAGE_REGION');
    const endpoint = this.configService.get<string>('STORAGE_ENDPOINT');
    const accessKeyId = this.configService.get<string>('STORAGE_ACCESS_KEY');
    const secretAccessKey =
      this.configService.get<string>('STORAGE_SECRET_KEY');

    if (accessKeyId && secretAccessKey && this.bucket) {
      this.s3Client = new S3Client({
        region: region || 'us-east-1', // Default region if not provided
        endpoint,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        forcePathStyle: true, // Needed for MinIO
      });
      this.logger.log('S3 storage client initialized successfully');
    }
  }

  onModuleInit() {
    if (!this.s3Client) {
      const missingConfig: string[] = [];
      if (!this.configService.get<string>('STORAGE_ACCESS_KEY')) {
        missingConfig.push('STORAGE_ACCESS_KEY');
      }
      if (!this.configService.get<string>('STORAGE_SECRET_KEY')) {
        missingConfig.push('STORAGE_SECRET_KEY');
      }
      if (!this.bucket) {
        missingConfig.push('STORAGE_BUCKET');
      }

      if (this.isStorageRequired) {
        throw new Error(
          `StorageService requires S3 configuration but the following environment variables are missing: ${missingConfig.join(', ')}. ` +
            `Either provide the required storage configuration or set STORAGE_REQUIRED=false to disable storage functionality.`,
        );
      } else {
        this.logger.warn(
          'Storage configuration is incomplete. StorageService will not function correctly. ' +
            `Missing: ${missingConfig.join(', ')}`,
        );
      }
    }
  }

  /**
   * Uploads a file to S3 and returns the object key together with a
   * freshly signed URL for immediate consumption.
   *
   * Callers that persist the result MUST store `key` and generate the
   * display URL on-demand via `getSignedUrl()`, otherwise the URL will expire.
   */
  async uploadFile(
    buffer: Buffer,
    originalFilename: string,
    mimeType: string,
    customKey?: string,
  ): Promise<UploadFileResult> {
    if (!this.s3Client) {
      throw new Error('Storage service is not configured');
    }

    // Use custom key if provided, otherwise generate one
    const key = customKey || `${uuidv4()}${extname(originalFilename)}`;

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
        }),
      );

      const url = await this.getSignedUrl(key);
      return { key, url };
    } catch (error) {
      this.logger.error(`Failed to upload file: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getSignedUrl(
    key: string,
    expiresIn = DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS,
  ): Promise<string> {
    if (!this.s3Client) {
      throw new Error('Storage service is not configured');
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      return await getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (error) {
      this.logger.error(
        `Failed to get signed URL: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Returns a signed URL for the given key, or null when no key is provided
   * or storage is not configured. Useful for response mapping where a
   * missing profile picture should not fail the request.
   */
  async getSignedUrlOrNull(
    key: string | null | undefined,
    expiresIn = DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS,
  ): Promise<string | null> {
    if (!key || !this.s3Client) {
      return null;
    }
    return this.getSignedUrl(key, expiresIn);
  }

  async deleteFile(key: string): Promise<void> {
    if (!this.s3Client) {
      throw new Error('Storage service is not configured');
    }

    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (error) {
      this.logger.error(`Failed to delete file: ${error.message}`, error.stack);
      throw error;
    }
  }
}
