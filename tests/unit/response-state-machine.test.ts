import { describe, expect, it } from "vitest";
import {
  canTransition,
  assertTransition,
  InvalidResponseTransitionError,
  isRevisionAcceptable,
} from "@/domains/responses";

describe("response status transitions", () => {
  it("allows the forward path", () => {
    expect(canTransition("in_progress", "partial")).toBe(true);
    expect(canTransition("partial", "completed")).toBe(true);
    expect(canTransition("in_progress", "completed")).toBe(true);
  });

  it("never allows completed to regress", () => {
    expect(canTransition("completed", "partial")).toBe(false);
    expect(canTransition("completed", "in_progress")).toBe(false);
  });

  it("never allows partial to regress to in_progress", () => {
    expect(canTransition("partial", "in_progress")).toBe(false);
  });

  it("throws a typed error on an invalid transition", () => {
    expect(() => assertTransition("completed", "partial")).toThrow(
      InvalidResponseTransitionError,
    );
  });
});

describe("isRevisionAcceptable", () => {
  it("accepts a strictly newer revision", () => {
    expect(isRevisionAcceptable(5, 6)).toBe(true);
  });

  it("rejects a stale or equal revision (duplicate/out-of-order retry)", () => {
    expect(isRevisionAcceptable(5, 5)).toBe(false);
    expect(isRevisionAcceptable(5, 4)).toBe(false);
  });
});
