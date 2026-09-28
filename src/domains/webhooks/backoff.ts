/**
 * Bounded exponential backoff schedule for webhook redelivery. Index
 * is the attempt number that just failed (0 = the first attempt);
 * value is how long to wait before the next one. After exhausting the
 * array, the delivery is marked 'exhausted' rather than retried
 * forever — "bounded" per the spec, not infinite.
 */
const BACKOFF_SCHEDULE_MS = [
  60_000, // 1 min after attempt 1
  5 * 60_000, // 5 min after attempt 2
  30 * 60_000, // 30 min after attempt 3
  2 * 60 * 60_000, // 2 hr after attempt 4
  12 * 60 * 60_000, // 12 hr after attempt 5
];

export const MAX_DELIVERY_ATTEMPTS = BACKOFF_SCHEDULE_MS.length + 1;

/** Given the attempt count that just failed (1-based — the count
 * *after* incrementing for this attempt), returns the delay in ms
 * before the next attempt, or null if attempts are exhausted. */
export function nextBackoffDelayMs(failedAttemptCount: number): number | null {
  const index = failedAttemptCount - 1;
  if (index < 0 || index >= BACKOFF_SCHEDULE_MS.length) return null;
  return BACKOFF_SCHEDULE_MS[index];
}

export function isExhausted(failedAttemptCount: number): boolean {
  return nextBackoffDelayMs(failedAttemptCount) === null;
}
