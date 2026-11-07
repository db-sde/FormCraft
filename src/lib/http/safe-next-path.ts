// A stand-in origin to resolve against: only its own paths are honoured.
const BASE = "https://formcraft.invalid";

/**
 * Where to send a user after an auth step, taken from a `next` value
 * the client controls. Only same-origin paths are honoured, so `?next=`
 * can't be used as an open redirect.
 *
 * The value is judged the way a browser will read it, not as typed:
 * browsers drop tabs and newlines and treat "\" as "/", so "/\t/evil.com"
 * or "/\\evil.com" mean "//evil.com", another site (found by the ZAP
 * scan of 2026-11-07). The normalised path is what's returned.
 */
export function safeNextPath(raw: unknown, fallback = "/dashboard"): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return fallback;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  // "/.//evil.com" normalises to "//evil.com": same origin here, but a
  // protocol-relative address once sent back as a redirect.
  if (!path.startsWith("/") || path.startsWith("//")) return fallback;
  return path;
}
