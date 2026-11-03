import { createCipheriv, createHash, randomBytes } from "node:crypto";
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { signingKey } from "@/lib/crypto/keys";
import {
  decryptJson,
  encryptJson,
  needsReencryption,
  type EncryptedPayload,
} from "@/lib/crypto/encryption";
import { buildCsp } from "@/lib/http/csp";
import { parseEmbedOrigins } from "@/domains/forms/embed-origins";
import { isDisallowedWebhookHost } from "@/domains/webhooks/url-safety";
import { parseClamdReply, scanBytes } from "@/domains/uploads/scan";
import { assessHealth } from "@/domains/observability/health";
import { hitRateLimit } from "@/domains/abuse";

const env = { ...process.env };
beforeEach(() => {
  process.env.APP_SECRET = "unit-test-app-secret";
  delete process.env.ENCRYPTION_KEYS;
});
afterEach(() => {
  process.env = { ...env };
});

const key32 = () => randomBytes(32).toString("base64");

describe("keys and encryption", () => {
  it("gives each signing purpose its own key", () => {
    const a = signingKey("connect-state");
    expect(a).toHaveLength(32);
    expect(a.equals(signingKey("form-unlock"))).toBe(false);
    expect(a.equals(signingKey("connect-state"))).toBe(true);
    expect(a.equals(Buffer.from("unit-test-app-secret"))).toBe(false);
  });

  it("binds a value to where it's stored", () => {
    const sealed = encryptJson({ secretKey: "sk" }, "credential:ws1:stripe");
    expect(sealed).toMatchObject({ v: 2, kid: "app" });
    expect(decryptJson(sealed, "credential:ws1:stripe")).toEqual({ secretKey: "sk" });
    // Copied into another workspace's row: refused.
    expect(() => decryptJson(sealed, "credential:ws2:stripe")).toThrow();
  });

  it("still reads values from before key ids, and marks them for rewriting", () => {
    const key = createHash("sha256").update("unit-test-app-secret").digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update('{"token":"old"}'), cipher.final()]);
    const legacy: EncryptedPayload = {
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    expect(decryptJson(legacy, "anything")).toEqual({ token: "old" });
    expect(needsReencryption(legacy)).toBe(true);
  });

  it("rotates: new values use the first key, old ones still decrypt", () => {
    const k1 = key32();
    process.env.ENCRYPTION_KEYS = `k1:${k1}`;
    const old = encryptJson("v", "ctx");
    expect(old.kid).toBe("k1");
    process.env.ENCRYPTION_KEYS = `k2:${key32()},k1:${k1}`;
    expect(decryptJson(old, "ctx")).toBe("v");
    expect(needsReencryption(old)).toBe(true);
    expect(encryptJson("v", "ctx").kid).toBe("k2");
    process.env.ENCRYPTION_KEYS = `k2:${key32()}`;
    expect(() => decryptJson(old, "ctx")).toThrow(/No encryption key "k1"/);
    process.env.ENCRYPTION_KEYS = "bad:short";
    expect(() => encryptJson("v")).toThrow(/32 bytes/);
  });
});

describe("network edges", () => {
  it("frames a form only where its owner allows", () => {
    const base = { nonce: "n", supabaseUrl: "https://x.supabase.co", publicForm: true };
    expect(buildCsp(base)).toContain("frame-ancestors *");
    expect(buildCsp({ ...base, frameAncestors: ["https://acme.com"] })).toContain(
      "frame-ancestors 'self' https://acme.com",
    );
    expect(
      parseEmbedOrigins("acme.com\nhttps://www.acme.com/pricing, https://acme.com"),
    ).toEqual({ ok: true, origins: ["https://acme.com", "https://www.acme.com"] });
    expect(parseEmbedOrigins("javascript:alert(1)").ok).toBe(false);
    expect(parseEmbedOrigins("  ").ok).toBe(false);
  });

  it("refuses 6to4, Teredo and documentation addresses", () => {
    expect(isDisallowedWebhookHost("[2002:a00:1::]")).toBe(true); // 6to4 → 10.0.0.1
    expect(isDisallowedWebhookHost("[2002:a9fe:a9fe::]")).toBe(true); // → 169.254.169.254
    expect(isDisallowedWebhookHost("[2002:808:808::]")).toBe(false); // → 8.8.8.8
    expect(isDisallowedWebhookHost("[2001:0:4136:e378::1]")).toBe(true); // Teredo
    expect(isDisallowedWebhookHost("192.0.2.10")).toBe(true);
    expect(isDisallowedWebhookHost("203.0.113.5")).toBe(true);
  });
});

describe("upload scanning", () => {
  it("reads clamd's answers", () => {
    expect(parseClamdReply("stream: OK\0")).toEqual({ status: "clean" });
    expect(parseClamdReply("stream: Eicar-Test-Signature FOUND\0")).toEqual({
      status: "infected",
      signature: "Eicar-Test-Signature",
    });
    expect(parseClamdReply("INSTREAM size limit exceeded. ERROR\0")).toMatchObject({
      status: "unavailable",
    });
  });

  it("streams the file to clamd, and fails closed when it can't be reached", async () => {
    const received: Buffer[] = [];
    const server = net.createServer((socket) => {
      socket.on("data", (d) => {
        received.push(d);
        const all = Buffer.concat(received);
        // Ends with a zero-length chunk.
        if (all.length > 14 && all.subarray(-4).readUInt32BE() === 0) {
          socket.end(all.includes("EICAR") ? "stream: Eicar FOUND\0" : "stream: OK\0");
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    try {
      expect(await scanBytes(Buffer.from("hello"), { host: "127.0.0.1", port })).toEqual({
        status: "clean",
      });
      received.length = 0;
      expect(
        await scanBytes(Buffer.from("X5O!P%@AP EICAR test"), { host: "127.0.0.1", port }),
      ).toMatchObject({ status: "infected" });
      expect(Buffer.concat(received).subarray(0, 10).toString()).toBe("zINSTREAM\0");
    } finally {
      server.close();
    }
    expect(
      await scanBytes(Buffer.from("x"), { host: "127.0.0.1", port, timeoutMs: 2000 }),
    ).toMatchObject({ status: "unavailable" });
    expect(await scanBytes(Buffer.from("x"))).toEqual({ status: "skipped" });
  });
});

describe("health and rate limits", () => {
  it("flags stuck app syncs, unsent reminders and duplicate payments", () => {
    const quiet = { overdue: 0, oldestOverdueMinutes: 0, exhaustedLast24h: 0 };
    const report = assessHealth({
      webhooks: quiet,
      sheets: quiet,
      connectors: { overdue: 2, oldestOverdueMinutes: 40, exhaustedLast24h: 0 },
      stuckUploads: 0,
      overdueReminders: 1,
      duplicatePaymentsLast24h: 1,
    });
    expect(report.status).toBe("degraded");
    expect(report.problems.join(" | ")).toMatch(/2 calendar or app syncs overdue/);
    expect(report.problems.join(" | ")).toMatch(/1 booking reminder not sent/);
    expect(report.problems.join(" | ")).toMatch(/1 duplicate payment/);
  });

  it("refuses a flood in memory, without a database write per request", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const admin = { rpc } as never;
    const key = `flood-${Math.random()}`;
    for (let i = 0; i < 3; i += 1)
      expect((await hitRateLimit(admin, key, 3, 60_000)).allowed).toBe(true);
    expect((await hitRateLimit(admin, key, 3, 60_000)).allowed).toBe(false);
    expect((await hitRateLimit(admin, key, 3, 60_000)).allowed).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});
