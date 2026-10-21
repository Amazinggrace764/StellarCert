import { Injectable, Optional, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Issuer } from '../../modules/issuers/entities/issuer.entity';
import { MetricsService } from '../monitoring/metrics.service';
import { LoggingService } from '../logging/logging.service';

import { IssuerTier, IssuerContext, RateLimitResult } from './rate-limit.types';

export const RATE_LIMIT_QUEUE_NAME = 'rate-limit-queue';

export enum RateLimitJobType {
  EXCEEDED = 'rate-limit-exceeded',
  UPGRADE_NOTIFICATION = 'rate-limit-upgrade-notification',
}

interface CachedIssuer {
  issuerId: string;
  tier: IssuerTier;
  cacheUntil: number;
}

/**
 * Minimal contract for a shared rate-limit store. Implementations must be
 * atomic across processes (e.g. Redis) so that multiple replicas share state.
 */
export interface RateLimitStore {
  /**
   * Atomically increment the counter for `key`, resetting the window if it has
   * expired. Returns the new count and the window start timestamp.
   */
  increment(
    key: string,
    windowMs: number,
    now: number,
  ): Promise<{ count: number; windowStart: number }>;
  /** Return the current count without incrementing (0 if expired). */
  getCount(
    key: string,
    windowMs: number,
    now: number,
  ): Promise<{ count: number; windowStart: number }>;
  /** Mark the upgrade notification as sent for this window. */
  markUpgradeNotified(
    key: string,
    windowMs: number,
    now: number,
  ): Promise<void>;
  /** Return whether the upgrade notification was already sent. */
  isUpgradeNotified(
    key: string,
    windowMs: number,
    now: number,
  ): Promise<boolean>;
  /** List all live buckets (for the usage summary). */
  list(): Promise<Array<{ key: string; count: number; windowStart: number }>>;
}

/**
 * In-memory fallback store. Only suitable for single-instance deployments or
 * tests. Production must provide a shared store (see RedisRateLimitStore).
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<
    string,
    { windowStart: number; count: number; upgradeNotified: boolean }
  >();

  private resolve(key: string, windowMs: number, now: number) {
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      bucket = { windowStart: now, count: 0, upgradeNotified: false };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  async increment(key: string, windowMs: number, now: number) {
    const bucket = this.resolve(key, windowMs, now);
    bucket.count += 1;
    return { count: bucket.count, windowStart: bucket.windowStart };
  }

  async getCount(key: string, windowMs: number, now: number) {
    const bucket = this.resolve(key, windowMs, now);
    return { count: bucket.count, windowStart: bucket.windowStart };
  }

  async markUpgradeNotified(key: string, windowMs: number, now: number) {
    this.resolve(key, windowMs, now).upgradeNotified = true;
  }

  async isUpgradeNotified(key: string, windowMs: number, now: number) {
    return this.resolve(key, windowMs, now).upgradeNotified;
  }

  async list() {
    return Array.from(this.buckets.entries()).map(([key, b]) => ({
      key,
      count: b.count,
      windowStart: b.windowStart,
    }));
  }
}

/**
 * Redis-backed shared store. Uses a single atomic LUA script per key so that
 * increments and window rollover are consistent across all replicas.
 */
export interface RedisClientLike {
  eval(
    script: string,
    numKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
  hgetall(key: string): Promise<Record<string, string>>;
}

const INCREMENT_SCRIPT  = `
-- KEY[1] = bucket key
-- ARG[1] = windowMs
-- ARG[2] = now
local key = KEY[1]
local windowMs = tonumber(ARG[1])
local now = tonumber(ARG[2])
local windowStart = tonumber(redis.call('HGET', key, 'windowStart') or '0')
if windowStart == 0 or now - windowStart >= windowMs then
  windowStart = now
  redis.call('HSET', key, 'windowStart', tostring(windowStart), 'count', '0', 'upgradeNotified', '0')
end
local count = redis.call('HINCRBY', key, 'count')
redis.call('PEXPIRE', key, tostring(windowMs * 2))
return { count, windowStart }
`;

const GET_COUNT_SCRIPT = `
-- KEY[1] = bucket key
-- ARG[1] = windowMs
-- ARG[2] = now
local key = KEY[1]
local windowMs = tonumber(ARG[1])
local now = tonumber(ARG[2])
local windowStart = tonumber(redis.call('HGET', key, 'windowStart') or '0')
if windowStart == 0 or now - windowStart >= windowMs then
  return { 0, windowStart }
end
local count = tonumber(redis.call('HGET', key, 'count') or '0')
return { count, windowStart }
`;

const MARK_UPGRADE_SCRIPT = `
-- KEY[1] = bucket key
local windowStart = tonumber(redis.call('HGET', KEY[1], 'windowStart') or '0')
if windowStart == 0 then return 0 end
redis.call('HSET', KEY[1], 'upgradeNotified', '1')
return 1
`;

const IS_UPGRADE_NOTIFIED_SCRIPT  = `
-- KEY[1] = bucket key
local windowStart = tonumber(redis.call('HGET', KEY[1], 'windowStart') or '0')
if windowStart == 0 then return '0' end
return redis.call('HGET', KEY[1], 'upgradeNotified') or '0'
`;

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly client: RedisClientLike) {}

  async increment(key: string, windowMs: number, now: number) {
    const result = (await this.client.eval(
      INCREMENT_SCRIPT,
      1,
      key,
      windowMs,
      now,
    )) as [number, number];
    return { count: Number(result[0]), windowStart: Number(result[1]) };
  }

  async getCount(key: string, windowMs: number, now: number) {
    const result = (await this.client.eval(
      GET_COUNT_SCRIPT ,
      1,
      key,
      windowMs,
      now,
    )) as [number, number];
    return { count: Number(result[0]), windowStart: Number(result[1]) };
  }

  async markUpgradeNotified(key: string, windowMs: number, now: number) {
    await this.client.eval(
      MARK_UPGRADE_SCRIPT,
      1,
      key,
      windowMs,
      now,
    );
  }

  async isUpgradeNotified(key: string, windowMs: number, now: number) {
    const raw = (await this.client.eval(
      IS_UPGRADE_NOTIFIED_SCRIPT ,
      1,
      key,
      windowMs,
      now,
    )) as string;
    return raw === '1';
  }

  async list() {
    const keys = await this.client.keys('rate-limit:*');
    const out: Array<{ key: string; count: number; windowStart: number }> = [];
    for (const key of keys) {
      const hash = await this.client.hgetall(key);
      if (!hash || !hash.windowStart) continue;
      out.push({
        key,
        count: Number(hash.count || 0),
        windowStart: Number(hash.windowStart),
      });
    }
    return out;
  }
}

export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

@Injectable()
export class RateLimitService {
  private readonly windowMs: number;
  private readonly freeLimit: number;
  private readonly paidLimit: number;
  private readonly store: RateLimitStore;
  private readonly issuerCache = new Map<string, CachedIssuer>();

  constructor(
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore decorators from TypeORM conflict with TS5 decorator types
    @InjectRepository(Issuer)
    private readonly issuerRepository: Repository<Issuer>,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore decorators from Bull conflict with TS5 decorator types
    @InjectQueue(RATE_LIMIT_QUEUE_NAME)
    private readonly rateLimitQueue: Queue,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
    private readonly loggingService: LoggingService,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore optional injection token for the shared store
    @Optional()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Inject(RATE_LIMIT_STORE)
    store?: RateLimitStore,
  ) {
    this.windowMs =
      Number(this.configService.get('RATE_LIMIT_WINDOW_MS')) || 60_000;
    this.freeLimit =
      Number(this.configService.get('RATE_LIMIT_FREE_PER_WINDOW')) || 60;
    this.paidLimit =
      Number(this.configService.get('RATE_LIMIT_PAID')) || 600;

    if (store) {
      this.store = store;
    } else {
      // Foot-gun for single-instance deployments and tests. Multi-replica
      // deployments MUST bind RATE_LIMIT_STORE to a shared store (Redis).
      this.store = new InMemoryRateLimitStore();
    }
  }

  async resolveIssuer(apiKey: string): Promise<IssuerContext | null> {
    const now = Date.now();
    const cached = this.issuerCache.get(apiKey);

    if (cached && cached.cacheUntil > now) {
      return { id: cached.issuerId, tier: cached.tier };
    }

    const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    const issuer = await this.issuerRepository.findOne({
      where: { apiKeyHash, isActive: true },
    });

    if (!issuer) {
      return null;
    }

    const tier = issuer.tier || IssuerTier.FREE;

    this.issuerCache.set(apiKey, {
      issuerId: issuer.id,
      tier,
      cacheUntil: now + 5 * 60_000,
    });

    return { id: issuer.id, tier };
  }

  async consume(
    issuerId: string,
    tier: IssuerTier,
    routeKey: string,
  ): Promise<RateLimitResult> {
    const key = this.bucketKey(issuerId, routeKey);
    const now = Date.now();
    const limit = tier === IssuerTier.PAID ? this.paidLimit : this.freeLimit;

    const { count, windowStart } = await this.store.increment(
      key,
      this.windowMs,
      now,
    );

    const resetAt = windowStart + this.windowMs;

    if (count > limit) {
      await this.enqueueExceeded(issuerId, tier, routeKey, now, limit, count);

      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAt,
      };
    }

    const remaining = Math.max(limit - count, 0);

    if (tier === IssuerTier.FREE && count >= Math.floor(limit * 0.8)) {
      const alreadyNotified = await this.store.isUpgradeNotified(
        key,
        this.windowMs,
        now,
      );
      if (!alreadyNotified) {
        await this.store.markUpgradeNotified(key, this.windowMs, now);
        await this.notifyUpgrade(issuerId, routeKey, limit, count);
      }
    }

    this.metricsService.recordHttpRequestDuration('API_KEY', routeKey, 200, 0);

    return {
      allowed: true,
      limit,
      remaining,
      resetAt,
    };
  }

  async getUsageSummary() {
    const summary: {
      issuerId: string;
      route: string;
      tier: IssuerTier;
      count: number;
      limit: number;
      resetAt: number;
    }[] = [];

    const now = Date.now();
    const entries = await this.store.list();

    for (const entry of entries) {
      if (now - entry.windowStart >= this.windowMs) {
        continue;
      }

      const parsed = this.parseBucketKey(entry.key);
      if (!parsed) continue;

      const tier = await this.resolveTier(parsed.issuerId);
      const limit = tier === IssuerTier.PAID ? this.paidLimit : this.freeLimit;

      summary.push({
        issuerId: parsed.issuerId,
        route: parsed.route,
        tier,
        count: entry.count,
        limit,
        resetAt: entry.windowStart + this.windowMs,
      });
    }

    return summary;
  }

  private bucketKey(issuerId: string, routeKey: string): string {
    return this.store instanceof RedisRateLimitStore
      ? `rate-limit:${issuerId}:${routeKey}`
      : `${issuerId}:${routeKey}`;
  }

  private parseBucketKey(key: string): { issuerId: string; route: string } | null {
    const normalized = key.startsWith('rate-limit:')
      ? key.slice('rate-limit:'.length)
      : key;
    const idx = normalized.indexOf(':');
    if (idx <= 0) return null;
    return {
      issuerId: normalized.slice(0, idx),
      route: normalized.slice(idx + 1),
    };
  }

  private async resolveTier(issuerId: string): Promise<IssuerTier> {
    const issuer = await this.issuerRepository.findOne({ where: { id: issuerId } });
    return issuer?.tier ??  IssuerTier.FREE;
  }

  private async enqueueExceeded(
    issuerId: string,
    tier: IssuerTier,
    routeKey: string,
    now: number,
    limit: number,
    count: number,
  ) {
    try {
      await this.rateLimitQueue.add(RateLimitJobType.EXCEEDED, {
        issuerId,
        tier,
        routeKey,
        timestamp: now,
        limit,
        count,
      });
    } catch (error) {
      this.loggingService.error?.('Failed to enqueue rate limit exceeded event', {
        error,
        issuerId,
        routeKey,
      });
    }
  }

  private async notifyUpgrade(
    issuerId: string,
    routeKey: string,
    limit: number,
    count: number,
  ) {
    try {
      await this.rateLimitQueue.add(RateLimitJobType.UPGRADE_NOTIFICATION, {
        issuerId,
        routeKey,
        limit,
        count,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.loggingService.error?.('Failed to enqueue rate limit upgrade notification', {
        error,
        issuerId,
        routeKey,
      });
    }
  }
}
