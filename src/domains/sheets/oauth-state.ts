import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The OAuth `state` for connecting Google Sheets. It used to be the
 * bare form id, which proves nothing about who started the flow. Now it
 * is a signed token carrying the form, the signed-in user, an expiry,
 * and a random nonce that is *also* set as an httpOnly cookie in the
 * browser that started the flow. The callback accepts it only if the
 * signature checks out, it hasn't expired, the same user is signed in,
 * and the cookie holds the same nonce — so a state forged, replayed
 * elsewhere, or fed to a different user's browser is rejected. The
 * cookie is cleared on use, so a state can't be replayed.
 */
export const OAUTH_STATE_COOKIE = "fc_oauth_nonce";
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

type StatePayload = { f: string; u: string; n: string; e: number };

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function secretOrThrow(secret = process.env.APP_SECRET): string {
  if (!secret) throw new Error("APP_SECRET is not set — required to sign OAuth state");
  return secret;
}

export function createOAuthState(
  input: { formId: string; userId: string },
  options: { secret?: string; now?: number } = {},
): { state: string; nonce: string } {
  const secret = secretOrThrow(options.secret);
  const nonce = randomBytes(16).toString("base64url");
  const payload: StatePayload = {
    f: input.formId,
    u: input.userId,
    n: nonce,
    e: Math.floor((options.now ?? Date.now()) / 1000) + OAUTH_STATE_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { state: `${body}.${sign(body, secret)}`, nonce };
}

export type OAuthStateResult =
  | { ok: true; formId: string }
  | {
      ok: false;
      reason: "malformed" | "bad_signature" | "expired" | "wrong_user" | "no_cookie";
    };

export function verifyOAuthState(
  state: string | null | undefined,
  expected: { userId: string; cookieNonce: string | null | undefined },
  options: { secret?: string; now?: number } = {},
): OAuthStateResult {
  const secret = secretOrThrow(options.secret);
  const [body, signature, ...rest] = (state ?? "").split(".");
  if (!body || !signature || rest.length > 0) return { ok: false, reason: "malformed" };

  const expectedSignature = sign(body, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof payload.f !== "string" ||
    typeof payload.u !== "string" ||
    typeof payload.n !== "string" ||
    typeof payload.e !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (payload.e < Math.floor((options.now ?? Date.now()) / 1000)) {
    return { ok: false, reason: "expired" };
  }
  if (payload.u !== expected.userId) return { ok: false, reason: "wrong_user" };

  const cookie = expected.cookieNonce;
  if (!cookie) return { ok: false, reason: "no_cookie" };
  const c = Buffer.from(cookie);
  const n = Buffer.from(payload.n);
  if (c.length !== n.length || !timingSafeEqual(c, n)) {
    return { ok: false, reason: "no_cookie" };
  }
  return { ok: true, formId: payload.f };
}
