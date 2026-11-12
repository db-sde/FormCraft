import { createHmac, timingSafeEqual } from "node:crypto";
import { signingKey } from "@/lib/crypto/keys";

/**
 * A response's write secret (QA FC4-14). Knowing a response's id isn't
 * enough to change it: /start sets this as a cookie scoped to that one
 * response's API paths, so the browser that started it sends it with
 * every save, upload, lookup and submit, and nobody else has it. A
 * resume link proves itself once and gets the cookie too (/claim).
 *
 * It's an HMAC of the id, so nothing is stored; responses started before
 * secrets existed are marked write_protected = false and don't need one.
 */
export const WRITE_SECRET_COOKIE = "fc_rt";

/** How long the browser keeps it: as long as a response can be resumed. */
export const WRITE_SECRET_MAX_AGE_SECONDS = 60 * 60 * 24 * 60;

export function writeSecretFor(responseId: string, secret?: string): string {
  return createHmac("sha256", signingKey("response-write", secret))
    .update(responseId)
    .digest("base64url");
}

export function isWriteSecretFor(
  responseId: string,
  presented: string | null | undefined,
  secret?: string,
): boolean {
  if (!presented) return false;
  const expected = Buffer.from(writeSecretFor(responseId, secret));
  const given = Buffer.from(presented);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The cookie's settings: only for this response's API paths; usable in
 * an embed (a third-party iframe) over HTTPS, kept to that embedding site. */
export function writeSecretCookie(responseId: string, secure: boolean) {
  return {
    name: WRITE_SECRET_COOKIE,
    value: writeSecretFor(responseId),
    options: {
      httpOnly: true,
      path: `/api/responses/${responseId}`,
      maxAge: WRITE_SECRET_MAX_AGE_SECONDS,
      sameSite: secure ? ("none" as const) : ("lax" as const),
      secure,
      partitioned: secure,
    },
  };
}
