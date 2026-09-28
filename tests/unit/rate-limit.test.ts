import { describe, expect, it, beforeEach, vi } from "vitest";
import { checkRateLimit, _resetRateLimitStateForTests } from "@/domains/abuse";

describe("checkRateLimit", () => {
  beforeEach(() => {
    _resetRateLimitStateForTests();
  });

  it("allows requests up to the limit", () => {
    const key = "ip:1.2.3.4";
    expect(checkRateLimit(key, 3, 60_000).allowed).toBe(true);
    expect(checkRateLimit(key, 3, 60_000).allowed).toBe(true);
    expect(checkRateLimit(key, 3, 60_000).allowed).toBe(true);
  });

  it("rejects once the limit is exceeded within the window", () => {
    const key = "ip:5.6.7.8";
    checkRateLimit(key, 2, 60_000);
    checkRateLimit(key, 2, 60_000);
    const third = checkRateLimit(key, 2, 60_000);
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it("tracks distinct keys independently", () => {
    checkRateLimit("a", 1, 60_000);
    const b = checkRateLimit("b", 1, 60_000);
    expect(b.allowed).toBe(true);
  });

  it("resets after the window expires", () => {
    vi.useFakeTimers();
    try {
      const key = "expiring";
      expect(checkRateLimit(key, 1, 1_000).allowed).toBe(true);
      expect(checkRateLimit(key, 1, 1_000).allowed).toBe(false);

      vi.advanceTimersByTime(1_001);

      expect(checkRateLimit(key, 1, 1_000).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
