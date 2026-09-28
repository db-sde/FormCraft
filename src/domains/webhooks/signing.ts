import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 over the exact raw payload bytes the consumer will
 * receive — signing must happen on the same serialized string that's
 * sent, not a re-serialization of the object, or a consumer's
 * signature check would fail on key-ordering differences. */
export function signPayload(secret: string, rawPayload: string): string {
  return createHmac("sha256", secret).update(rawPayload, "utf8").digest("hex");
}

export function signatureHeaderValue(secret: string, rawPayload: string): string {
  return `sha256=${signPayload(secret, rawPayload)}`;
}

/** Constant-time comparison — used by anything that ever needs to
 * verify a signature (not the sender, but kept alongside signing since
 * it's the same primitive; e.g. a future inbound-webhook feature). */
export function verifySignature(
  secret: string,
  rawPayload: string,
  headerValue: string,
): boolean {
  const expected = signatureHeaderValue(secret, rawPayload);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(headerValue);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
