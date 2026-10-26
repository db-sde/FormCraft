import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook signatures, Stripe-style. Each delivery carries
 *
 *   X-FormCraft-Timestamp: 1793031457
 *   X-FormCraft-Signature: t=1793031457,v1=<hex HMAC-SHA256>
 *
 * where the HMAC is over `"<timestamp>.<raw body>"` with the endpoint's
 * own secret. Signing the timestamp too means a captured delivery can't
 * be replayed later: receivers reject a timestamp more than five minutes
 * old (verifySignature does). Signing is over the exact bytes sent, never
 * a re-serialisation.
 */

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function signPayload(
  secret: string,
  timestamp: number,
  rawPayload: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawPayload}`, "utf8")
    .digest("hex");
}

export function signatureHeaderValue(
  secret: string,
  timestamp: number,
  rawPayload: string,
): string {
  return `t=${timestamp},v1=${signPayload(secret, timestamp, rawPayload)}`;
}

/** The headers a signed delivery carries, signed at the moment of sending. */
export function signatureHeaders(
  secret: string,
  rawPayload: string,
  now: Date = new Date(),
): Record<string, string> {
  const timestamp = Math.floor(now.getTime() / 1000);
  return {
    "X-FormCraft-Timestamp": String(timestamp),
    "X-FormCraft-Signature": signatureHeaderValue(secret, timestamp, rawPayload),
  };
}

/** What a receiver does: the signature must match and be recent. Kept
 * here (constant-time) as the reference implementation for docs/tests. */
export function verifySignature(
  secret: string,
  rawPayload: string,
  headerValue: string,
  now: Date = new Date(),
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): boolean {
  const parts = Object.fromEntries(
    headerValue.split(",").map((part) => {
      const at = part.indexOf("=");
      return [part.slice(0, at).trim(), part.slice(at + 1).trim()];
    }),
  );
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !parts.v1) return false;
  if (Math.abs(Math.floor(now.getTime() / 1000) - timestamp) > toleranceSeconds)
    return false;
  const expected = Buffer.from(signPayload(secret, timestamp, rawPayload));
  const actual = Buffer.from(parts.v1);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
