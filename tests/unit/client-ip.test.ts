import { describe, expect, it } from "vitest";
import { resolveClientIp } from "@/lib/http/ip";

const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null;

describe("resolveClientIp", () => {
  it("does not trust whatever the visitor put first in X-Forwarded-For", () => {
    // A proxy appends the address it actually saw; the visitor chose the rest.
    const ip = resolveClientIp(
      headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }),
      {},
    );
    expect(ip).toBe("203.0.113.9");
  });

  it("can't be dodged by sending a different fake address each time", () => {
    const real = "203.0.113.9";
    const a = resolveClientIp(headers({ "x-forwarded-for": `1.1.1.1, ${real}` }), {});
    const b = resolveClientIp(headers({ "x-forwarded-for": `2.2.2.2, ${real}` }), {});
    expect(a).toBe(b);
  });

  it("skips as many proxies from the right as TRUSTED_PROXY_HOPS says", () => {
    const h = headers({ "x-forwarded-for": "198.51.100.7, 203.0.113.9, 10.0.0.1" });
    expect(resolveClientIp(h, { TRUSTED_PROXY_HOPS: "2" })).toBe("203.0.113.9");
    expect(resolveClientIp(h, { TRUSTED_PROXY_HOPS: "3" })).toBe("198.51.100.7");
    // More hops than entries: the leftmost, not an error.
    expect(resolveClientIp(h, { TRUSTED_PROXY_HOPS: "9" })).toBe("198.51.100.7");
  });

  it("prefers the header the host is configured to set itself", () => {
    const h = headers({
      "x-forwarded-for": "6.6.6.6",
      "cf-connecting-ip": "203.0.113.50",
    });
    expect(resolveClientIp(h, { CLIENT_IP_HEADER: "CF-Connecting-IP" })).toBe(
      "203.0.113.50",
    );
  });

  it("falls back when the configured header is missing", () => {
    const h = headers({ "x-forwarded-for": "203.0.113.9" });
    expect(resolveClientIp(h, { CLIENT_IP_HEADER: "cf-connecting-ip" })).toBe(
      "203.0.113.9",
    );
  });

  it("reads IPv6 and falls back to X-Real-IP, then 'unknown'", () => {
    expect(resolveClientIp(headers({ "x-forwarded-for": "2001:db8::1" }), {})).toBe(
      "2001:db8::1",
    );
    expect(resolveClientIp(headers({ "x-real-ip": "203.0.113.4" }), {})).toBe(
      "203.0.113.4",
    );
    expect(resolveClientIp(headers({}), {})).toBe("unknown");
  });

  it("refuses junk instead of using it as a rate-limit key", () => {
    expect(resolveClientIp(headers({ "x-forwarded-for": "x".repeat(500) }), {})).toBe(
      "unknown",
    );
    expect(resolveClientIp(headers({ "x-forwarded-for": "<script>" }), {})).toBe(
      "unknown",
    );
  });
});
