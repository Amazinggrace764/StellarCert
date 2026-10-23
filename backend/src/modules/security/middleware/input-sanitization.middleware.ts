import { Injectable, NestMiddleWare } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * Global input-sanitization middleware.
 *
 * Strips script tags from string values in body/query/params while preserving
 * whitespace control characters (newline, carriage return, tab) that are
 * legitimate in multi-line fields, addresses, and JSON-metadata strings.
 */
@Injectable()
export class InputSanitizationMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    req.body = this.sanitize(req.body);
    const sanitizedQuery = this.sanitize(req.query) as Record<string, unknown>;
    for (const key of Object.keys(sanitizedQuery)) {
      (req.query as Record<string, unknown>)[key] = sanitizedQuery[key];
    }
    req.params = this.sanitize(req.params);

    next();
  }

  private sanitize(value: unknown): any {
    if (typeof value === 'string') {
      return value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
        .trim();
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitize(item));
    }

    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).reduce(
        (acc, [key, currentValue]) => {
          acc[key] = this.sanitize(currentValue);
          return acc;
        },
        {} as Record<string, unknown>,
      );
    }

    return value;
  }
}
