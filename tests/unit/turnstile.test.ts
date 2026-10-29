import { describe, expect, it } from "vitest";
import { verifyTurnstile } from "@/domains/abuse/turnstile";

/** A stand-in for Cloudflare's siteverify that records what it was sent. */
function fakeCloudflare(reply: () => Response | Promise<Response>) {
  const calls: URLSearchParams[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    calls.push(init?.body as URLSearchParams);
    return reply();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("Turnstile verification (F-26)", () => {
  it("passes a token Cloudflare accepts, sending the address", async () => {
    const cf = fakeCloudflare(() => json({ success: true }));
    const result = await verifyTurnstile("tok", {
      secret: "s",
      remoteIp: "203.0.113.9",
      fetchImpl: cf.fetchImpl,
    });
    expect(result).toEqual({ ok: true });
    expect(cf.calls[0].get("secret")).toBe("s");
    expect(cf.calls[0].get("response")).toBe("tok");
    expect(cf.calls[0].get("remoteip")).toBe("203.0.113.9");
  });

  it("rejects a token Cloudflare refuses", async () => {
    const cf = fakeCloudflare(() =>
      json({ success: false, "error-codes": ["timeout-or-duplicate"] }),
    );
    expect(
      await verifyTurnstile("tok", { secret: "s", fetchImpl: cf.fetchImpl }),
    ).toEqual({ ok: false, reason: "rejected", codes: ["timeout-or-duplicate"] });
  });

  it("fails closed when there's no token, without asking Cloudflare", async () => {
    const cf = fakeCloudflare(() => json({ success: true }));
    expect(
      await verifyTurnstile(undefined, { secret: "s", fetchImpl: cf.fetchImpl }),
    ).toEqual({ ok: false, reason: "missing_token" });
    expect(cf.calls).toHaveLength(0);
  });

  it("fails closed when the secret key isn't set", async () => {
    const cf = fakeCloudflare(() => json({ success: true }));
    expect(
      await verifyTurnstile("tok", { secret: null, fetchImpl: cf.fetchImpl }),
    ).toEqual({
      ok: false,
      reason: "not_configured",
    });
    expect(cf.calls).toHaveLength(0);
  });

  it("fails closed, as our problem, when Cloudflare is down or errors", async () => {
    const down = fakeCloudflare(() => {
      throw new TypeError("fetch failed");
    });
    expect(
      await verifyTurnstile("tok", { secret: "s", fetchImpl: down.fetchImpl }),
    ).toEqual({ ok: false, reason: "unavailable" });
    const status = fakeCloudflare(() => json({}, 502));
    expect(
      await verifyTurnstile("tok", { secret: "s", fetchImpl: status.fetchImpl }),
    ).toEqual({ ok: false, reason: "unavailable" });
    const internal = fakeCloudflare(() =>
      json({ success: false, "error-codes": ["internal-error"] }),
    );
    expect(
      await verifyTurnstile("tok", { secret: "s", fetchImpl: internal.fetchImpl }),
    ).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("never treats a reply without success: true as a pass", async () => {
    const cf = fakeCloudflare(() => json({ success: "true" }));
    expect(
      (await verifyTurnstile("tok", { secret: "s", fetchImpl: cf.fetchImpl })).ok,
    ).toBe(false);
  });
});
