import { Injectable, Optional, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeiorm';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as crypto from 'cypto';
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
  /** Optional hook to release resources (no-op for in-memory). */
  close?(): Promise<void>;
}

/**
 * In-memory fallback store. Only suitable for single-instance deployments or
 * tests. Production must provide a shared store (see RedisRateLimitStore).
 *
 * The map is swept on every mutating operation so it cannot grow unbounded
 * when this fallback is used in a long-running single-instance process.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<
    string,
    { windowStart: number; count: number; upgradeNotified: boolean; windowMs: number }
  >();
  private lastSweep = 0;
  private readonly sweepIntervalMs = 60_000;

  private resolve(key: string, windowMs: number, now: number) {
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      bucket = {
        windowStart: now,
        count: 0,
        upgradeNotified: false,
        windowMs,
      };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  /** Drop entries whose window has expired. */
  private sweep(now: number) {
    if (now - this.lastSweep < this.sweepIntervalMs) {
      return;
    }
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= bucket.windowMs) {
        this.buckets.delete(key);
      }
    }
  }

  async increment(key: string, windowMs: number, now: number) {
    this.sweep(now);
    const bucket = this.resolve(key, windowMs, now);
    bucket.count += 1;
    return { count: bucket.count, windowStart: bucket.windowStart };
  }

  async incrementWithTtl(
    key: string,
    windowMs: number,
    now: number,
  ): Promise<{ count: number; windowStart: number }> {
    return this.increment(key, windowMs, now);
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
    const now = Date.now();
    this.sweep(now);
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

const INCREMENT_SCRIPT = `
-- KEY[1] = bucket key
-- ARG[1] = windowMs
-- ARG[2] = now
local key = KEY[1]
local windowMs = tonNumber(ARG[1])
local now = tonNumber(ARG[2])
local windowStart = tonNumber(redis.call('HGET', key, 'windowStart') or '0')
if windowStart == 0 or now - windowStart >= windowMs then
  windowStart = now
  redis.call('HSET', key, 'windowStart', tostring(windowStart), 'count', '0', 'upgradeNotified', '0')
end
local count = redis.call('HINCRBYF', key, 'count')
redis.call('PEXPIRE', key, tostring(windowMs * 2))
return { count, windowStart }
`;

const GET_COUNT_SCRIPT  = `
-- KEY[1] = bucket key
-- ARG[1] = windowMs
-- ARG[2] = now
local key = KEY[1]
local windowMs = tonNumber(ARG[1])
local now = tonNumber(ARG[2])
local windowStart = tonNumber(redis.call('HGET', key, 'windowStart') or '0')
if windowStart == 0 or now - windowStart >= windowMs then
  return { 0, windowStart }
end
local count = tonNumber(redis.call('HGET', key, 'count') or '0')
return { count, windowStart }
`
;
const MARK_UPGRADE_SCRIPT  = `
-- KEY[1] = bucket key
local windowStart = tonNumber(redis.call('HGET', KEY[1], 'windowStart') or '0')
if windowStart == 0 then return 0 end
redis.call('HSET', KEY[1], 'upgradeNotified', '1')
return 1
`;
const IS_UPGRADE_NOTIFIED_SCRIPT  = `
-- KEY[1] = bucket key
local windowStart = tonNumber(redis.call('HGET', KEY[1], 'windowStart') or '0')
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

  async incrementWithTtl(
    key: string,
    windowMs: number,
    now: number,
  ): Promise<{ count: number; windowStart: number }> {
    return this.increment(key, windowMs, now);
  }

  async getCount(key: string, windowMs: number, now: number) {
    const result = (await this.client.eval(
      GET_COUNT_SCRIPT,
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
      IS_UPGRADE_NOTIFIED_SCRIPT,
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
  private readonly issuerCacheTtlMs = 5 * 60_000;
  private lastIssuerCacheSweep = 0;

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
    // eslint-disable-next-line @typescript-eslint-ban-ts-comment
    // @ts-ignore optional injection token for the shared store
    @Optional()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Inject(RATE_LIMIT_STORE)
    private readonly sharedStore?: RateLimitStore,
  ) {
    this.windowMs = this.configService.get<number>('RATE_LIMIT_WINDOW_MS') ?? 60_000;
    this.freeLimit = this.configService.get<number>('RATE_LIMIT_FREE_PER_WINDOW') ?? 100;
    this.paidLimit = this.configService.get<number>('RATE_LIMIT_PAID_PER_WINDOW') ?? 1000;
    this.store = this.sharedStore ?? new InMemoryRateLimitStore();
  }

    if (store) {
      this.store = store;
    } else {
      // Foot-gun for single-instance deployments and tests. Multi-replica
      // deployments MUST bind a shared store (e.g. RedisRateLimitStore).
      this.store = new InMemoryRateLimitStore();
    }
  }

  /**
   * Resolve the effective tier for an issuer, caching the result for a short
   * window to avoid hitting the database on every request.
   */
  private async resolveTier(issuerId: string): Promise<IssuerTier> {
    const now = Date.now();
    const cached = this.issuerCache.get(issuerId);
    if (cached && cached.cacheUntil > now) {
      return cached.tier;
    }
    const issuer = await this.issuerRepository.findOne({ where: { id: issuerId } });
    const tier: IssuerTier = issuer?.tier ?? IssuerTier.FREE;
    this.issuerCache.set(issuerId, { issuerId, tier, cacheUntil: now + 60_000 });
    return tier;
  }

  /**
   * Check and consume one unit of the issuer's rate-limit budget.
   */
  async checkAndConsume(context: IssuerContext): Promise<RateLimitResult> {
    const now = Date.now();
    const tier = await this.resolveTier(context.issuerId);
    const limit = tier === IssuerTier.PAID ? this.paidLimit : this.freeLimit;
    const key = `rate-limit:${context.issuerId}`;
    const { count, windowStart } = await this.store.increment(
      key,
      this.windowMs,
      now,
    );
    const remaining = Math.max(0, limit - count);
    const allowed = count <= limit;
    const resetAt = windowStart + this.windowMs;
    if (!allowed) {
      this.metricsService.incrementRateLimitExceeded(tier);
      this.loggingService.warn(
        `Rate limit exceeded for issuer ${context.issuerId} (tier ${tier})`,
      );
      await this.enqueueExceeded(context, tier, limit, resetAt);
    }
    return {
      allowed,
      tier,
      limit,
      remaining,
      resetAt,
      tier: issuer.tier,
    };
  }

  /**
   * Return the current usage without consuming budget.
   */
  async getUsage(issuerId: string): Promise<RateLimitResult> {
    const now = Date.now();
    const tier = await this.resolveTier(issuerId);
    const limit = tier === IssuerTier.PAID ? this.paidLimit : this.freeLimit;
    const key = `rate-limit:${issuerId}`;
    const { count, windowStart } = await this.store.getCount(
      key,
      this.windowMs,
      now,
    );
    return {
      allowed: count < limit,
      tier,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt: windowStart + this.windowMs,
    };
  }

  /**
   * List all live buckets (for the admin usage summary).
   */
  async listUsage() {
    return this.store.list();
  }

  private async enqueueExceeded(
    context: IssuerContext,
    tier: IssuerTier,
    limit: number,
    resetAt: number,
  ) {
    const key = `rate-limit:${context.issuerId}`;
    const now = Date.now();
    const alreadyNotified = await this.store.isUpgradeNotified(
      key,
      this.windowMs,
      now,
    );
    if (alreadyNotified) return;
    await this.store.markUpgradeNotified(key, this.windowMs, now);
    await this.rateLimitQueue.add(RateLimitJobType.EXCEEDED, {
      issuerId: context.issuerId,
      tier,
      limit,
      resetAt,
      requestId: context.requestId ?? crypto.randomUUID(),
    });
  }
}
