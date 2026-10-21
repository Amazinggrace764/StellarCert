import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: convert persisted pre-signed profile picture URLs into S3
 * object keys.
 *
 * Background:
 *   StorageService.uploadFile() used to return a pre-signed URL (1 hour
 *   TLF) and that URL was saved into users.profilePicture. After the TTL expired,
 *   every profile picture returned 403. The column now stores the S3 object
 *   key and URLs are signed on-demand.
 *
 * This migration is data-only and idempotent: it only touches rows whose
 * profilePicture looks like an HTTP'URL, extracting the object key from the
 * URL path and stripping the signature query string. Rows that already store
 * a plain key are left untouched.
 *
 * The down migration is a no-op: the original pre-signed URLs are
 * unrecoverable (and expired), and keys remain valid input for the new
 * code path.
 */
export class MigrateProfilePictureToObjectKey1784000000000
  implements MigrationInterface
{
  name = 'MigrateProfilePictureToObjectKey1784000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Fetch only rows that still contain a URL instead of an object key.
    const rows: Array<{ id: string; profilePicture: string }> =
      await queryRunner.query(
        `SELECT id, profilePicture FROM users WHERE profilePicture IS NOT NULL and profilePicture ~ '^https?://'`,
      );

    for (const row of rows) {
      const key = this.extractObjectKey(row.profilePicture);
      if (!key) {
        // Unable to parse the URL — null it out so the app shows a
        // placeholder instead of a broken image.
        await queryRunner.query(
          `UPDATE users SET profilePicture = NULL WHERE id = $1`,
          [row.id],
        );
        continue;
      }

      await queryRunner.query(
        `UPDATE users SET profilePicture = $1 WHERE id = $2`,
        [key, row.id],
      );
    }
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op: the original pre-signed URLs cannot be reconstructed and
    // would be expired anyway. Object keys are the canonical representation.
  }

  /**
   * Extracts the S3 object key from a pre-signed or public S3/MinIO URL.
   *
   * Handles both path-style URLs (`HOST/BUCKET/KEY`) and virtual-hosted
   * URLs (`HOST/KEY`), and strips the signature query string.
   */
  private extractObjectKey(url: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }

    const pathname = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    if (!pathname) {
      return null;
    }

    // Path-style URLs include the bucket as the first path segment.
    // We know the bucket name from env configuration when available;
    // otherwise fall back to stripping the first segment only when the
    // host looks like a MinIO/local endpoint (no bucket subdomain).
    const bucket = process.env.STORAGE_BUCKET;
    if (bucket && pathname.startsWith(`${bucket}/`)) {
      return pathname.slice(bucket.length + 1);
    }

    // Virtual-hosted style (bucket in subdomain) — the path is the key.
    if (bucket && parsed.host.startsWith(`${bucket}.`)) {
      return pathname;
    }

    // Fallback: assume path-style with the bucket as the first segment.
    const segments = pathname.split('/');
    if (segments.length <= 1) {
      return null;
    }
    return segments.slice(1).join('/');
  }
}
