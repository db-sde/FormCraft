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

  it("judges the path the way a browser reads it (ZAP, 2026-11-07)", () => {
    // Browsers drop tabs and newlines and read "\" as "/": each of these
    // would land on evil.com.
    for (const raw of [
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r\n/evil.com",
      "/\t\\evil.com",
      "/.//evil.com",
      "/\\\\evil.com",
    ]) {
      expect(safeNextPath(raw), JSON.stringify(raw)).toBe("/dashboard");
      const resolved = new URL(safeNextPath(raw), "https://app.example");
      expect(resolved.origin).toBe("https://app.example");
    }
    // Same-origin paths that look odd are kept, tidied.
    expect(safeNextPath("/forms/../templates")).toBe("/templates");
    expect(safeNextPath("/%2F/evil.com")).toBe("/%2F/evil.com");
    expect(safeNextPath("/forms/a b")).toBe("/forms/a%20b");
  });

  it("falls back for missing values", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath(undefined, "/login")).toBe("/login");
  });
});
