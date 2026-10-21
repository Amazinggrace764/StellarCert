import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { RateLimitService } from '../../../common/rate-limiting/rate-limit.service';
import { LoggingService } from '../../../common/logging/logging.service';
import {
  RATE_LIMIT_OPTIONS_KEY,
  RateLimitOptions,
} from '../decorators/rate-limit.decorator';

interface RequestWithContext extends Request {
  user?: { id?: string; sub?: string };
  issuer?: { id: string; tier: string };
}

interface LocalBucket {
  windowStart: number;
  count: number;
}

interface GuardRateResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  reason?: string;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly usage = new Map<string, LocalBucket>();
  private readonly defaultWindowMs: number;
  private readonly defaultMaxRequests: number;
  private readonly bruteForceWindowMs: number;
  private readonly bruteForceMaxAttempts: number;

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService,
    private readonly apiKeyRateLimitService: RateLimitService,
  ) {
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';

    this.defaultWindowMs =
      Number(this.configService.get('RATE_LIMIT_DEFAULT_WINDOW_MS')) || 60_000;

    this.defaultMaxRequests =
      Number(this.configService.get('RATE_LIMIT_DEFAULT_MAX_REQUESTS')) ||
      (isProd ? 120 : 1_000);

    this.bruteForceWindowMs =
      Number(this.configService.get('AUTH_BRUTE_FORCE_WINDOW_MS')) || 60_000;

    this.bruteForceMaxAttempts =
      Number(this.configService.get('AUTH_BRUTE_FORCE_MAX_ATTEMPTS')) || 5;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithContext>();
    const response = http.getResponse<Response>();
    const routeKey = this.routeKey(request);

    await this.enforceApiKeyRateLimit(request, response, routeKey);
    this.enforceRequestRateLimit(context, request, response, routeKey);

    return true;
  }

  private async enforceApiKeyRateLimit(
    request: RequestWithContext,
    response: Response,
    routeKey: string,
  ): Promise<void> {
    const apiKey = this.extractApiKey(request);
    if (!apiKey) {
      return;
    }

    const issuer = await this.apiKeyRateLimitService.resolveIssuer(apiKey);

    if (!issuer) {
      this.loggingService.warn('Blocked request with invalid API key', {
        path: request.originalUrl,
        method: request.method,
        ip: request.ip,
      });
      throw new UnauthorizedException('Invalid API key');
    }

    request.issuer = issuer;

    const result = await this.apiKeyRateLimitService.consume(
      issuer.id,
      issuer.tier,
      routeKey,
    );

    response.setHeader('X-ApiKey-RateLimit-Limit', result.limit.toString());
    response.setHeader(
      'X-ApiKey-RateLimit-Remaining',
      result.remaining.toString(),
    );
    response.setHeader(
      'X-ApiKey-RateLimit-Reset',
      Math.floor(result.resetAt / 1000).toString(),
    );

    if (!result.allowed) {
      this.logBlockedRequest(request, routeKey, 'api-key-limit-exceeded');
      this.throwRateLimitError(response, result.resetAt);
    }
  }

  private enforceRequestRateLimit(
    context: ExecutionContext,
    request: RequestWithContext,
    response: Response,
    routeKey: string,
  ): void {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_OPTIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    const isBruteForceRoute = this.isBruteForceRoute(request);
    const limit = isBruteForceRoute
      ? this.bruteForceMaxAttempts
      : options?.limit || this.defaultMaxRequests;
    const windowMs = isBruteForceRoute
      ? this.bruteForceWindowMs
      : options?.windowMs || this.defaultWindowMs;

    const bucketKey = this.buildBucketKey(
      request,
      routeKey,
      options,
      isBruteForceRoute,
    );
    const result = this.consume(bucketKey, limit, windowMs, isBruteForceRoute);

    response.setHeader('X-RateLimit-Limit', result.limit.toString());
    response.setHeader('X-RateLimit-Remaining', result.remaining.toString());
    response.setHeader(
      'X-RateLimit-Reset',
      Math.floor(result.resetAt / 1000).toString(),
    );

    if (!result.allowed) {
      this.logBlockedRequest(
        request,
        routeKey,
        result.reason || 'rate-limited',
      );
      this.throwRateLimitError(response, result.resetAt);
    }
  }

  private consume(
    key: string,
    limit: number,
    windowMs: number,
    isBruteForceRoute: boolean,
  ): GuardRateResult {
    const now = Date.now();
    const bucket = this.usage.get(key);

    if (!bucket || now - bucket.windowStart >= windowMs) {
      this.usage.set(key, { windowStart: now, count: 1 });
      return {
        allowed: true,
        limit,
        remaining: Math.max(limit - 1, 0),
        resetAt: now + windowMs,
      };
    }

    if (bucket.count >= limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAt: bucket.windowStart + windowMs,
        reason: isBruteForceRoute
          ? 'brute-force-protection-triggered'
          : 'global-rate-limit-exceeded',
      };
    }

    bucket.count += 1;

    return {
      allowed: true,
      limit,
      remaining: Math.max(limit - bucket.count, 0),
      resetAt: bucket.windowStart + windowMs,
    };
  }

  private buildBucketKey(
    request: RequestWithContext,
    routeKey: string,
    options: RateLimitOptions | undefined,
    isBruteForceRoute: boolean,
  ): string {
    if (isBruteForceRoute) {
      return `bruteforce:${this.clientIp(request)}:${routeKey}`;
    }

    const keyBy = options?.keyBy || 'user';

    if (keyBy === 'apiKey') {
      const apiKey = this.extractApiKey(request);
      if (apiKey) {
        return `apiKey:${this.hashValue(apiKey)}:${routeKey}`;
      }
    }

    if (keyBy === 'user') {
      const userId =
        request.user?.id || request.user?.sub || request.issuer?.id;
      if (userId) {
        return `user:${userId}:${routeKey}`;
      }
    }

    return `ip:${this.clientIp(request)}:${routeKey}`;
  }

  private clientIp(request: Request): string {
    const forwardedFor = request.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string') {
      const firstIp = forwardedFor.split(',')[0]?.trim();
      if (firstIp) {
        return firstIp;
      }
    }

    return request.ip || request.socket.remoteAddress || 'unknown';
  }

  private routeKey(request: Request): string {
    const path = request.route?.path || request.path || request.originalUrl;
    return `${request.method}:${path}`;
  }

  private extractApiKey(request: Request): string | undefined {
    const apiKeyHeader = request.headers['x-api-key'];

    if (typeof apiKeyHeader === 'string') {
      return apiKeyHeader;
    }

    if (Array.isArray(apiKeyHeader)) {
      return apiKeyHeader[0];
    }

    return undefined;
  }

  private isBruteForceRoute(request: Request): boolean {
    if (request.method !== 'POST') {
      return false;
    }

    const normalizedPath = (request.originalUrl || request.url).toLowerCase();

    return [
      '/auth/login',
      '/auth/register',
      '/auth/refresh',
      '/auth/forgot-password',
      '/auth/reset-password',
    ].some((segment) => normalizedPath.includes(segment));
  }

  private throwRateLimitError(response: Response, resetAt: number): never {
    const retryAfterSeconds = Math.max(
      Math.ceil((resetAt - Date.now()) / 1000),
      1,
    );

    response.setHeader('Retry-After', retryAfterSeconds.toString());

    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many requests',
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private logBlockedRequest(
    request: RequestWithContext,
    routeKey: string,
    reason: string,
  ): void {
    this.loggingService.warn('Blocked request by security rate limiter', {
      reason,
      path: request.originalUrl,
      method: request.method,
      routeKey,
      ip: this.clientIp(request),
      userId: request.user?.id || request.user?.sub || request.issuer?.id,
    });
  }

  private hashValue(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 16);
  }
}
