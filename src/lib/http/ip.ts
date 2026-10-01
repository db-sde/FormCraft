/**
 * Working out which address a request came from, for rate limiting.
 *
 * `X-Forwarded-For` is a list the client can start and every proxy
 * appends to, so its FIRST entry is whatever the client wrote — trusting
 * it lets anyone dodge a per-IP limit by sending a fresh made-up value
 * each time. The entries a proxy we run added are at the END. So:
 *
 *  - `CLIENT_IP_HEADER` (optional): name a header your host sets itself
 *    and overwrites on every request (e.g. `x-vercel-forwarded-for`,
 *    `cf-connecting-ip`, `fly-client-ip`). Used when present.
 *  - otherwise the `X-Forwarded-For` entry `TRUSTED_PROXY_HOPS` from the
 *    right (default 1: the address our nearest proxy saw connecting).
 *    On Vercel that header holds just the client's address, so this is it.
 *  - otherwise `X-Real-IP`, otherwise "unknown" (everyone without an
 *    address shares one bucket, which is the safe direction to fail).
 *
 * A rate limiter is a speed bump, not a security boundary, but it
 * shouldn't be one request header away from useless.
 */
type ReadHeader = (name: string) => string | null | undefined;
type Env = Record<string, string | undefined>;

// IPv4, IPv6 (incl. v4-mapped), nothing else — also keeps junk out of
// rate-limit keys.
const IP_SHAPE = /^[0-9a-fA-F:.]{2,45}$/;

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && IP_SHAPE.test(trimmed) ? trimmed : null;
}

export function resolveClientIp(header: ReadHeader, env: Env = process.env): string {
  const named = env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (named) {
    const first = clean(header(named)?.split(",")[0]);
    if (first) return first;
  }

  const forwarded = header("x-forwarded-for");
  if (forwarded) {
    const hops = Math.max(1, Math.floor(Number(env.TRUSTED_PROXY_HOPS)) || 1);
    const entries = forwarded.split(",").map((e) => e.trim());
    const entry = clean(entries[Math.max(0, entries.length - hops)]);
    if (entry) return entry;
  }

  return clean(header("x-real-ip")) ?? "unknown";
}
