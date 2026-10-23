export enum IssuerTier {
  FREE = 'free',
  PAID = 'paid',
}

export interface IssuerContext {
  id: string;
  tier: IssuerTier;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}
