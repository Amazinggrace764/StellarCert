import { Injectable, NestMiddleware, Inject, Optional } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';

interface RateLimitData {
  count: number;
  expiresAt: number;
}

@Injectable()
export class AuthRateLimitMiddleware implements NestMiddleware {
  private readonly limit = 5;
  private readonly windowSeconds = 60; // 1 minute
  private readonly windowMs = this.windowSeconds * 1000;

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @Optional() private configService?: ConfigService,
  ) {}

  /**
   * Resolve the client IP for rate limiting.
   *
   * Express is configured with a bounded `trust proxy` setting (see
   * `main.ts`), so `req.ip` is already the correct client address for trusted
   * peers and the socket address for untrusted ones. We must NOT honor
   * `x-forwarded-for` here - that is client-supplied and would let any client
   * forge the rate-limit bucket.
   */
  private getClientIp(req: Request): string {
    return (
      req.ip ||
      req.socket?.remoteAddress ||
      (req as any).connection?.remoteAddress ||
      'unknown'
    );
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const ip = this.getClientIp(req);
    const key = `rate:auth:${String(ip)}`;

    try {
      const now = Date.now();
      const existing = await this.cacheManager.get<RateLimitData | number>(key);

      let count = 0;
      let expiresAt = now + this.windowMs;

      if (typeof existing === 'object' && existing !== null) {
        if (existing.expiresAt && now < existing.expiresAt) {
          count = existing.count;
          expiresAt = existing.expiresAt;
        }
      } else if (typeof existing === 'number' && existing > 0) {
        count = existing;
      }

      if (count >= this.limit) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((expiresAt - now) / 1000),
        );
        res.setHeader('Retry-After', String(retryAfterSeconds));
        res.status(429).json({
          statusCode: 429,
          message: 'Too many requests. Please try again later.',
        });
        return;
      }

      const nextCount = count + 1;
      const remainingMs = Math.max(1, expiresAt - now);

      await this.cacheManager.set(
        key,
        { count: nextCount, expiresAt },
        remainingMs,
      );

      next();
    } catch (err) {
      console.error(
        'AuthRateLimitMiddleware cache error (failing closed):',
        err,
      );
      res.status(503).json({
        statusCode: 503,
        message:
          'Authentication service temporarily unavailable. Please try again later.',
      });
    }
  }
}
