/**
 * Bounded, in-memory fixed-window rate limiter for the public response
 * endpoints (start/answers/complete). "Bounded" in two senses, per
 * CLAUDE.md's abuse-prevention rule: each key's own state expires
 * (fixed window, not accumulated forever), and the map itself has a
 * hard cap on distinct keys so a flood of forged/random ids can't grow
 * memory unboundedly — the oldest entries are evicted first.
 *
 * This is a single-instance limiter: correct for one Node process, not
 * for a horizontally-scaled deployment (see docs/testing.md /
 * PROJECT_STATUS.md — a shared store like Upstash Redis is the
 * documented upgrade path, RATE_LIMIT_KV_* in .env.example is reserved
 * for it). Good enough to ship Phase 1 with, not the final answer.
 */

type Bucket = { count: number; resetAt: number };

const MAX_TRACKED_KEYS = 20_000;

const buckets = new Map<string, Bucket>();

function evictExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function evictOldestIfOverCapacity() {
  while (buckets.size > MAX_TRACKED_KEYS) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey === undefined) break;
    buckets.delete(oldestKey);
  }
}

export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: number };

/** Returns whether `key` is still within `limit` requests per
 * `windowMs`. Call once per request; every call counts toward the
 * limit, including ones that end up rejected. */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();

  if (buckets.size > MAX_TRACKED_KEYS / 2) evictExpired(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const bucket: Bucket = { count: 1, resetAt: now + windowMs };
    buckets.set(key, bucket);
    evictOldestIfOverCapacity();
    return { allowed: true, remaining: limit - 1, resetAt: bucket.resetAt };
  }

  existing.count += 1;
  return {
    allowed: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  };
}

/** Test-only escape hatch — production code never needs to reset the
 * shared module-level state. */
export function _resetRateLimitStateForTests() {
  buckets.clear();
}
