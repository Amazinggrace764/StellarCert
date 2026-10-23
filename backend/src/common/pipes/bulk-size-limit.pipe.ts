import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';

/** Default maximum number of IDs accepted in a single bulk request. */
export const DEFAULT_BULK_MAX = 100;

/**
 * Validates that a bulk-operation payload does not exceed the configured size
 * limit. Apply this pipe to any endpoint that receives an array of IDs
 * (e.g. bulkRevoke, bulkExport) to prevent memory exhaustion and long-running
 * database queries.
 *
 * @example
 * \@Post('bulk-revoke')
 * \@UsePipes(new BulkSizeLimitPipe())
 * bulkRevoke(\@Body() dto: BulkRevokeDto) { ... }
 */
@Injectable()
export class BulkSizeLimitPipe implements PipeTransform {
  constructor(private readonly max: number = DEFAULT_BULK_MAX) {}

  transform(value: unknown): unknown {
    const ids = this.extractIds(value);

    if (ids !== null && ids.length > this.max) {
      throw new BadRequestException(
        `Bulk operations are limited to ${this.max} items per request. ` +
          `Received ${ids.length}.`,
      );
    }

    return value;
  }

  private extractIds(value: unknown): unknown[] | null {
    if (Array.isArray(value)) return value;

    if (value !== null && typeof value === 'object') {
      for (const key of ['ids', 'certificateIds', 'items']) {
        const field = (value as Record<string, unknown>)[key];
        if (Array.isArray(field)) return field;
      }
    }

    return null;
  }
}
