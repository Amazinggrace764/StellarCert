import { Injectable, NestMiddleware, Inject, Optional } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { parseTrustedProxies } from '../../../config/environment.config';

interface RateLimitData {
  count: number;
  expiresAt: number;
}

/**
 * Normalize an IP address for comparison. Strips IPv4-mapped IPv6 prefixes
 * and any zone identifier.
 */
function normalizeIp(ip: string | undefined): string {
  if (!ip) return '';
  let out = ip.trim();
  if (out.startsWith('::ffff:')) {
    out = out.slice('::ffff:'.length);
  }
  const zoneIdx = out.indexOf('%');
  if (zoneIdx >= 0) {
    out = out.slice(0, zoneIdx);
  }
  return out.toLowerCase();
}

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    num = num * 256 + n;
  }
  return num;
}

function ipv4InCidr(ip: string, cidr: string, prefixLen: number): boolean {
  const ipNum = ipv4ToNumber(ip);
  const netNum = ipv4ToNumber(cidr);
  if (ipNum === null || netNum === null) return false;
  if (prefixLen <= 0) return true;
  if (prefixLen >= 32) return ipNum === netNum;
  const mask = (0xffffffff << (32 - prefixLen)) >>> 0;
  return (ipNum & mask) === (netNum & mask);
}

/**
 * Checks whether the given peer address matches any entry in the trusted
 * proxy list. Entries may be exact IPs, IPv4 CIDR ranges, or the wildcard
 * '*' (trust all).
 */
export function isTrustedProxyAddress(
  peerAddress: string | undefined,
  trustedProxies: string[],
): boolean {
  const peer = normalizeIp(peerAddress);
  if (!peer) return false;
  for (const entry of trustedProxies) {
    const norm = normalizeIp(entry);
    if (!norm) continue;
    if (norm === '*') {
      return true;
    }
    if (norm === peer) {
      return true;
    }
    const slashIdx = norm.indexOf('/');
    if (slashIdx > 0) {
      const network = norm.slice(0, slashIdx);
      const prefix = Number(norm.slice(slashIdx + 1));
      if (Number.isInteger(prefix) && ipv4InCidr(peer, network, prefix)) {
        return true;
      }
    }
  }
  return false;
}

@Injectable()
export class AuthRateLimitMiddleware implements NestMiddleware {
  private readonly limit = 5;
  private readonly windowSeconds = 60; // 1 minute
  private readonly windowMs = this.windowSeconds * 1000;
  private readonly trustedProxies: string[];

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @Optional() private configService?: ConfigService,
  ) {
    const configured = this.configService?.get<string>('TRUSTED_PROXIES');
    this.trustedProxies = parseTrustedProxies(configured);
  }

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
        // Legacy shape: a plain counter. Treat it as the current window.
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
      // Preserve the original window - do not reset the TTL on every hit.
      const remainingMs = Math.max(1, expiresAt - now);

      // cache-manager v5 interprets the TTL argument as milliseconds.
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

/**
 * Sanitize a single forwarded IP (first hop of X-Forwarded-For). Returns
 * undefined when the value is not a plausible IPv4/IPv6 address.
 */
function sanitizeForwardedIp(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // Reject anything that is not a plain address (no spaces, brackets, or ports).
  if (/[\s\[\]]/.test(trimmed)) {
    // Strip an IPv6 bracket form like [::1]:80.
    const bracketMatch = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed);
    if (bracketMatch) {
      return normalizeIp(bracketMatch[1]);
    }
    return undefined;
  }
  // Strip a trailing port for IPv4 (e.g. 1.2.3.4:56).
  const ipv4WithPort = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+$/.exec(trimmed);
  const candidate = ipv4WithPort ? ipv4WithPort[1] : trimmed;
  const norm = normalizeIp(candidate);
  if (!norm) return undefined;
  // Basic shape validation: IPv4 or IPv6.
  if (ipv4ToNumber(norm) !== null) return norm;
  if (/^[0-9a-f]:+|^[0-9a-f]*[::][0-9a-f]*$/.test(norm)) {
    return norm;
  }
  return undefined;
}
