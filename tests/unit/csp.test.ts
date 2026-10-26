import { describe, expect, it } from "vitest";
import { buildCsp, newNonce } from "@/lib/http/csp";

const parse = (csp: string) =>
  Object.fromEntries(
    csp.split("; ").map((d) => {
      const [name, ...values] = d.split(" ");
      return [name, values];
    }),
  );

describe("Content-Security-Policy", () => {
  const base = { nonce: "abc123", supabaseUrl: "https://proj.supabase.co" };

  it("lets only this response's scripts run, and nothing else in", () => {
    const csp = parse(buildCsp({ ...base, publicForm: false }));
    expect(csp["script-src"]).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["img-src"]).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://proj.supabase.co",
    ]);
    expect(csp["connect-src"]).toEqual([
      "'self'",
      "https://proj.supabase.co",
      "wss://proj.supabase.co",
    ]);
    expect(csp["upgrade-insecure-requests"]).toEqual([]);
    // No wildcard source anywhere in the app's policy.
    expect(Object.values(csp).flat()).not.toContain("*");
    expect(Object.values(csp).flat()).not.toContain("https:");
  });

  it("lets published forms be embedded and run the creator's pixels", () => {
    const csp = parse(buildCsp({ ...base, publicForm: true }));
    expect(csp["frame-ancestors"]).toEqual(["*"]);
    expect(csp["script-src"]).toContain("https://www.googletagmanager.com");
    expect(csp["connect-src"]).toContain("https://www.google-analytics.com");
  });

  it("allows eval and dev sockets only in development", () => {
    const dev = parse(buildCsp({ ...base, publicForm: false, dev: true }));
    expect(dev["script-src"]).toContain("'unsafe-eval'");
    expect(dev["upgrade-insecure-requests"]).toBeUndefined();
    expect(parse(buildCsp({ ...base, publicForm: false }))["script-src"]).not.toContain(
      "'unsafe-eval'",
    );
  });

  it("makes a different nonce each time", () => {
    expect(newNonce()).not.toBe(newNonce());
    expect(newNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe("upgrade-insecure-requests", () => {
  it("is only sent over HTTPS (it would break every asset on plain http)", () => {
    const opts = { nonce: "n", supabaseUrl: "https://p.supabase.co", publicForm: false };
    expect(buildCsp({ ...opts, https: true })).toContain("upgrade-insecure-requests");
    expect(buildCsp({ ...opts, https: false })).not.toContain(
      "upgrade-insecure-requests",
    );
  });
});
