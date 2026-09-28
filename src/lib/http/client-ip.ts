import "server-only";
import { headers } from "next/headers";

/** Same best-effort IP extraction as
 * @/app/api/responses/shared.ts's getClientIp, for the Server Actions
 * (auth forms) that have no NextRequest to read headers from directly
 * — next/headers is the Server Action equivalent. Not spoof-proof
 * behind an untrusted proxy; good enough for a bounded rate limiter,
 * not a security boundary on its own. */
export async function getClientIpFromHeaders(): Promise<string> {
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  const realIp = h.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}
