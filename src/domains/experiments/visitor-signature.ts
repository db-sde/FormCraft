import { createHmac, timingSafeEqual } from "node:crypto";
import { signingKey } from "@/lib/crypto/keys";

/**
 * Which visitor ids FormCraft itself issued (QA FC11-12). The visitor
 * cookie earns a public form's caller a looser start limit (one device,
 * one person), so it can't be anything a script makes up: alongside the
 * id the proxy sets a signature only the server can make. An id without
 * a valid one is treated as no visitor at all. Server-only (Node crypto).
 */
export const VISITOR_SIG_COOKIE = "fc_vsig";

export function visitorSignature(id: string, secret?: string): string {
  return createHmac("sha256", signingKey("visitor", secret))
    .update(id)
    .digest("base64url")
    .slice(0, 32);
}

export function isSignedVisitor(
  id: string | undefined,
  signature: string | undefined,
  secret?: string,
): boolean {
  if (!id || !signature || signature.length !== 32) return false;
  const expected = Buffer.from(visitorSignature(id, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
