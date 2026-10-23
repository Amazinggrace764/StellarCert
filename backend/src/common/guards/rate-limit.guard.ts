import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { RateLimitService } from '../rate-limiting/rate-limit.service';

/**
 * Headers that may carry the client IP when the request passes through a
 * trusted proxy. These are only honoured when the immediate peer is in the
 * trusted proxy list.
 */
const FORWARDED_FOR_HEADER = 'x-forwarded-for';
const REAL_IP_HEADER = 'x-real-ip';

const IPv4MAP_REGEXP =
  /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}$/;
const IPv6_MAP_REGEXP = /^[0-9a-fA-F:]+$/;

function isValidIp(candidate: string): boolean {
  const value = candidate.trim();
  if (!value) {
    return false;
  }

  if (IPv4MAP_REGEXP.test(value)) {
    return true;
  }

  // IPv6 addresses must contain at least one colon and only hex characters.
  if (!value.includes(':') || !IPv6_MAP_REGEXP.test(value)) {
    return false;
  }

  // Reject multiple colon-separated addresses and outpaced zone identifiers.
  if (value.includes('::')) {
    return false;
  }

  return true;
}

function normalizeIp(candidate: string): string | undefined {
  const value = candidate.trim();
  if (!isValidIp(value)) {
    return undefined;
  }
  return value.toLowerCase();
}

function getHeaderValue(
  headers: Request['headers'],
  name: string,
): string | undefined {
  const raw = headers[name];
  if (typeof raw === 'string') {
    return raw;
  }
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return undefined;
}

function trustedProxySet(trustedProxies: string[]): Set<string> {
  const set = new Set<string>();
  for (const proxy of trustedProxies) {
    const normalized = normalizeIp(proxy);
    if (normalized) {
      set.add(normalized);
    }
  }
  return set;
}

export function getClientIp(
  request: Request,
  trustedProxies: string[] = [],
): string | undefined {
  const socketIp = request.socket?.remoteAddress
    ? normalizeIp(request.socket.remoteAddress)
    : undefined;

  const remoteIp = socketIp ?? normalizeIp(request.ip ?? '');

  // Only trust forwarding headers when the immediate peer is a known proxy.
  if (!remoteIp || !trustedProxySet(trustedProxies).has(remoteIp)) {
    return remoteIp;
  }

  const forwardedFor = getHeaderValue(request.headers, FORWARDED_FOR_HEADER);
  if (forwardedFor) {
    // `X-Forwarded-For` can contain a comma-separated chain; the client is the
    // leftmost hop in the chain. Take the leftmost valid entry and ignore any
    // optional port or bracketed IPv6 formatting.
    for (const part of forwardedFor.split(',')) {
      const candidate = part
        .trim()
        .replace(/^\[(.+)\]$/, '$1')
        .replace(/:\d+$/, '');
      const normalized = normalizeIp(candidate);
      if (normalized) {
        return normalized;
      }
    }
  }

  const realIp = getHeaderValue(request.headers, REAL_IP_HEADER);
  if (realIp) {
    const normalized = normalizeIp(realIp);
    if (normalized) {
      return normalized;
    }
  }

  return remoteIp;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly rateLimitService: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const apiKeyHeader = request.headers['x-api-key'];
    const apiKey =
      typeof apiKeyHeader === 'string'
        ? apiKeyHeader
        : Array.isArray(apiKeyHeader)
          ? apiKeyHeader[0]
          : undefined;

    if (!apiKey) {
      return true;
    }

    const issuer = await this.rateLimitService.resolveIssuer(apiKey);

    if (!issuer) {
      throw new UnauthorizedException('Invalid API key');
    }

    (request as any).issuer = issuer;

    const routePath =
      (request as any).route?.path ||
      (request as any).originalUrl ||
      request.url;

    const clientIp = getClientIp(
      request,
      this.rateLimitService.getTrustedProxies(),
    );

    const result = await this.rateLimitService.consume(
      issuer.id,
      issuer.tier,
      routePath,
      clientIp,
    );

    response.setHeader('X-RateLimit-Limit', result.limit.toString());
    response.setHeader('X-RateLimit-Remaining', result.remaining.toString());
    response.setHeader(
      'X-RateLimit-Reset',
      Math.floor(result.resetAt / 1000).toString(),
    );

    if (!result.allowed) {
      const retryAfterSeconds = Math.max(
        Math.ceil((result.resetAt - Date.now()) / 1000),
        1,
      );

      response.setHeader('Retry-After', retryAfterSeconds.toString());

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Rate limit exceeded',
          retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
