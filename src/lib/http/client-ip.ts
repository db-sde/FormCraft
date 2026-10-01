import "server-only";
import { headers } from "next/headers";
import { resolveClientIp } from "./ip";

/** The client address for Server Actions (auth forms), which have no
 * NextRequest to read headers from — next/headers is their equivalent.
 * See ./ip.ts for how the address is chosen and why. */
export async function getClientIpFromHeaders(): Promise<string> {
  const h = await headers();
  return resolveClientIp((name) => h.get(name));
}
