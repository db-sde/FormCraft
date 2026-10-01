import { describe, expect, it } from "vitest";
import {
  createOAuthState,
  OAUTH_STATE_TTL_SECONDS,
  verifyOAuthState,
} from "@/domains/sheets/oauth-state";

const secret = "test-secret";
const input = { formId: "form-1", userId: "user-1" };
const now = 1_800_000_000_000;

describe("OAuth state", () => {
  it("accepts the user and browser that started the flow", () => {
    const { state, nonce } = createOAuthState(input, { secret, now });
    expect(
      verifyOAuthState(state, { userId: "user-1", cookieNonce: nonce }, { secret, now }),
    ).toEqual({ ok: true, formId: "form-1" });
  });

  it("rejects a different signed-in user", () => {
    const { state, nonce } = createOAuthState(input, { secret, now });
    expect(
      verifyOAuthState(
        state,
        { userId: "someone-else", cookieNonce: nonce },
        { secret, now },
      ),
    ).toEqual({ ok: false, reason: "wrong_user" });
  });

  it("rejects a browser that didn't start the flow (missing or wrong cookie)", () => {
    const { state } = createOAuthState(input, { secret, now });
    for (const cookieNonce of [undefined, "", "not-the-nonce"]) {
      expect(
        verifyOAuthState(state, { userId: "user-1", cookieNonce }, { secret, now }).ok,
      ).toBe(false);
    }
  });

  it("rejects an expired state", () => {
    const { state, nonce } = createOAuthState(input, { secret, now });
    const later = now + (OAUTH_STATE_TTL_SECONDS + 1) * 1000;
    expect(
      verifyOAuthState(
        state,
        { userId: "user-1", cookieNonce: nonce },
        { secret, now: later },
      ),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects tampering: a changed payload, a changed signature, another secret", () => {
    const { state, nonce } = createOAuthState(input, { secret, now });
    const [body, signature] = state.split(".");
    const forgedBody = Buffer.from(
      JSON.stringify({ f: "victim-form", u: "user-1", n: nonce, e: now / 1000 + 600 }),
    ).toString("base64url");
    const expected = { userId: "user-1", cookieNonce: nonce };
    for (const forged of [
      `${forgedBody}.${signature}`,
      `${body}.${signature.slice(0, -2)}AA`,
      `${body}.`,
      "garbage",
      "",
    ]) {
      expect(verifyOAuthState(forged, expected, { secret, now }).ok, forged).toBe(false);
    }
    expect(verifyOAuthState(state, expected, { secret: "other-secret", now }).ok).toBe(
      false,
    );
  });

  it("rejects the bare form id the old flow used", () => {
    expect(
      verifyOAuthState(
        "0b4d2a57-b80f-4d9a-b12e-440fa43157dd",
        {
          userId: "user-1",
          cookieNonce: "x",
        },
        { secret, now },
      ).ok,
    ).toBe(false);
  });
});
