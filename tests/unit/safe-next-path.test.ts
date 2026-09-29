import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/http/safe-next-path";

describe("safeNextPath", () => {
  it("keeps same-origin paths", () => {
    expect(safeNextPath("/forms/abc?tab=1")).toBe("/forms/abc?tab=1");
    expect(safeNextPath("/reset-password")).toBe("/reset-password");
  });

  it("rejects anything that could leave the origin", () => {
    for (const raw of ["https://evil.com", "//evil.com", "/\\evil.com", "evil.com", ""]) {
      expect(safeNextPath(raw), raw).toBe("/dashboard");
    }
  });

  it("falls back for missing values", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath(undefined, "/login")).toBe("/login");
  });
});
