import { describe, expect, it, vi } from "vitest";
import {
  signPayload,
  signatureHeaderValue,
  signatureHeaders,
  verifySignature,
} from "@/domains/webhooks/signing";
import {
  nextBackoffDelayMs,
  isExhausted,
  MAX_DELIVERY_ATTEMPTS,
} from "@/domains/webhooks/backoff";
import { buildWebhookPayload, serializeWebhookPayload } from "@/domains/webhooks/payload";
import {
  isDisallowedWebhookHost,
  resolvesToDisallowedAddress,
} from "@/domains/webhooks/url-safety";

describe("signPayload / verifySignature", () => {
  const t = 1_793_031_457;
  const at = (seconds: number) => new Date(seconds * 1000);

  it("produces a deterministic signature for the same secret, time and payload", () => {
    expect(signPayload("secret", t, '{"a":1}')).toBe(signPayload("secret", t, '{"a":1}'));
  });

  it("changes with the secret, the payload and the timestamp", () => {
    const base = signPayload("secret", t, '{"a":1}');
    expect(signPayload("secret-2", t, '{"a":1}')).not.toBe(base);
    expect(signPayload("secret", t, '{"a":2}')).not.toBe(base);
    expect(signPayload("secret", t + 1, '{"a":1}')).not.toBe(base);
  });

  it("verifySignature accepts a correctly signed header and rejects a forged one", () => {
    const payload = '{"eventId":"abc"}';
    const header = signatureHeaderValue("secret", t, payload);
    expect(header).toMatch(/^t=1793031457,v1=[0-9a-f]{64}$/);
    expect(verifySignature("secret", payload, header, at(t))).toBe(true);
    expect(verifySignature("secret", payload, `t=${t},v1=deadbeef`, at(t))).toBe(false);
    expect(verifySignature("wrong-secret", payload, header, at(t))).toBe(false);
  });

  it("rejects a replayed delivery once it's more than five minutes old", () => {
    const payload = '{"eventId":"abc"}';
    const header = signatureHeaderValue("secret", t, payload);
    expect(verifySignature("secret", payload, header, at(t + 299))).toBe(true);
    expect(verifySignature("secret", payload, header, at(t + 301))).toBe(false);
    // Moving the timestamp forward breaks the signature.
    const moved = header.replace(`t=${t}`, `t=${t + 600}`);
    expect(verifySignature("secret", payload, moved, at(t + 600))).toBe(false);
  });

  it("signs at the moment of sending", () => {
    const headers = signatureHeaders("secret", "{}", at(t));
    expect(headers["X-FormCraft-Timestamp"]).toBe(String(t));
    expect(verifySignature("secret", "{}", headers["X-FormCraft-Signature"], at(t))).toBe(
      true,
    );
  });
});

describe("backoff schedule", () => {
  it("returns an increasing delay for each successive failed attempt", () => {
    const delays = Array.from({ length: MAX_DELIVERY_ATTEMPTS - 1 }, (_, i) =>
      nextBackoffDelayMs(i + 1),
    );
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
    }
  });

  it("is exhausted (bounded, not infinite) after MAX_DELIVERY_ATTEMPTS failures", () => {
    expect(isExhausted(MAX_DELIVERY_ATTEMPTS)).toBe(true);
    expect(nextBackoffDelayMs(MAX_DELIVERY_ATTEMPTS)).toBeNull();
  });

  it("is not exhausted before the max", () => {
    expect(isExhausted(1)).toBe(false);
  });
});

describe("buildWebhookPayload / serializeWebhookPayload", () => {
  it("round-trips exactly what was built, including answers", () => {
    const payload = buildWebhookPayload({
      eventId: "evt_1",
      formId: "form_1",
      responseId: "resp_1",
      submittedAt: "2026-01-01T00:00:00.000Z",
      endingId: "end_default",
      answers: { q1: "hello", q2: 5 },
    });
    const serialized = serializeWebhookPayload(payload);
    expect(JSON.parse(serialized)).toEqual(payload);
    expect(payload.eventType).toBe("response.completed");
  });

  it("the signature covers the exact serialized string, so any mutation invalidates it", () => {
    const payload = buildWebhookPayload({
      eventId: "evt_1",
      formId: "form_1",
      responseId: "resp_1",
      submittedAt: "2026-01-01T00:00:00.000Z",
      endingId: null,
      answers: {},
    });
    const serialized = serializeWebhookPayload(payload);
    const now = new Date();
    const header = signatureHeaderValue(
      "secret",
      Math.floor(now.getTime() / 1000),
      serialized,
    );

    const tampered = serialized.replace("resp_1", "resp_2");
    expect(verifySignature("secret", serialized, header, now)).toBe(true);
    expect(verifySignature("secret", tampered, header, now)).toBe(false);
  });
});

describe("isDisallowedWebhookHost", () => {
  it("allows ordinary public-looking hostnames", () => {
    expect(isDisallowedWebhookHost("example.com")).toBe(false);
    expect(isDisallowedWebhookHost("api.mycompany.io")).toBe(false);
  });

  it("allows localhost/loopback outside production (local development)", () => {
    expect(isDisallowedWebhookHost("localhost")).toBe(false);
    expect(isDisallowedWebhookHost("127.0.0.1")).toBe(false);
    expect(isDisallowedWebhookHost("[::1]")).toBe(false);
  });

  it("blocks loopback in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(isDisallowedWebhookHost("localhost")).toBe(true);
      expect(isDisallowedWebhookHost("127.0.0.1")).toBe(true);
      expect(isDisallowedWebhookHost("127.1.2.3")).toBe(true);
      expect(isDisallowedWebhookHost("[::1]")).toBe(true);
      expect(isDisallowedWebhookHost("[::ffff:7f00:1]")).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("blocks private and metadata addresses hidden in IPv6 forms", () => {
    // What `new URL(...).hostname` actually yields for these.
    for (const url of [
      "http://[::ffff:169.254.169.254]/",
      "http://[::ffff:10.0.0.1]/",
      "http://[64:ff9b::a9fe:a9fe]/",
      "http://[fd00::1]/",
      "http://[fe80::1]/",
      "http://[::]/",
    ]) {
      expect(isDisallowedWebhookHost(new URL(url).hostname), url).toBe(true);
    }
    expect(isDisallowedWebhookHost(new URL("http://[2606:4700::1111]/").hostname)).toBe(
      false,
    );
  });

  it("blocks alternate IPv4 spellings once URL-normalized", () => {
    for (const url of [
      "http://2852039166/",
      "http://0xa9.0xfe.0xa9.0xfe/",
      "http://0/",
    ]) {
      expect(isDisallowedWebhookHost(new URL(url).hostname), url).toBe(true);
    }
  });

  it("blocks other reserved IPv4 ranges", () => {
    expect(isDisallowedWebhookHost("100.64.0.1")).toBe(true);
    expect(isDisallowedWebhookHost("224.0.0.1")).toBe(true);
    expect(isDisallowedWebhookHost("8.8.8.8")).toBe(false);
  });

  it("blocks the cloud metadata / link-local address", () => {
    expect(isDisallowedWebhookHost("169.254.169.254")).toBe(true);
  });

  it("blocks private IPv4 ranges", () => {
    expect(isDisallowedWebhookHost("10.0.0.5")).toBe(true);
    expect(isDisallowedWebhookHost("192.168.1.1")).toBe(true);
    expect(isDisallowedWebhookHost("172.16.0.1")).toBe(true);
    expect(isDisallowedWebhookHost("172.31.255.255")).toBe(true);
  });

  it("does not block a public address that merely starts with 172 outside the private range", () => {
    expect(isDisallowedWebhookHost("172.32.0.1")).toBe(false);
    expect(isDisallowedWebhookHost("172.15.0.1")).toBe(false);
  });

  it("blocks .internal and .local suffixed hostnames", () => {
    expect(isDisallowedWebhookHost("service.internal")).toBe(true);
    expect(isDisallowedWebhookHost("myhost.local")).toBe(true);
  });

  it("blocks 0.0.0.0", () => {
    expect(isDisallowedWebhookHost("0.0.0.0")).toBe(true);
  });
});

describe("resolvesToDisallowedAddress", () => {
  it("rejects a hostname that resolves to loopback in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(await resolvesToDisallowedAddress("localhost")).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("judges IP literals without a DNS lookup", async () => {
    expect(await resolvesToDisallowedAddress("10.1.2.3")).toBe(true);
    expect(await resolvesToDisallowedAddress("8.8.8.8")).toBe(false);
  });

  it("leaves unresolvable names to fail at delivery", async () => {
    expect(await resolvesToDisallowedAddress("no-such-host.invalid")).toBe(false);
  });
});
