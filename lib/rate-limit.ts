/**
 * Process-local rate limiter. Fine for single-instance / hobby deploys.
 * Multi-instance production should swap this for Redis/Upstash later.
 */

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterMs: number; remaining: 0 };

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
};

export function rateLimit(input: RateLimitOptions): RateLimitResult {
  const now = input.now ?? Date.now();
  const existing = buckets.get(input.key);
  if (!existing || now >= existing.resetAt) {
    buckets.set(input.key, { count: 1, resetAt: now + input.windowMs });
    return { ok: true, remaining: Math.max(0, input.limit - 1) };
  }
  if (existing.count >= input.limit) {
    return { ok: false, remaining: 0, retryAfterMs: existing.resetAt - now };
  }
  existing.count += 1;
  return { ok: true, remaining: Math.max(0, input.limit - existing.count) };
}

/** Test helper — do not use in product code. */
export function resetRateLimitStore() {
  buckets.clear();
}

export function rateLimitErrorMessage(result: Extract<RateLimitResult, { ok: false }>) {
  const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  return `Too many requests. Try again in ${seconds}s.`;
}

export const RATE_LIMITS = {
  draftSave: { limit: 30, windowMs: 60_000 },
  submit: { limit: 8, windowMs: 60_000 },
  follow: { limit: 20, windowMs: 60_000 },
  authEmail: { limit: 5, windowMs: 15 * 60_000 },
  unlockWrite: { limit: 40, windowMs: 60_000 },
  adminImport: { limit: 12, windowMs: 60_000 },
  adminParser: { limit: 20, windowMs: 60_000 },
} as const;
