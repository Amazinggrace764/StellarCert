import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_OPTIONS_KEY = 'security:rate-limit-options';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  keyBy?: 'ip' | 'user' | 'apiKey';
}

export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_OPTIONS_KEY, options);
