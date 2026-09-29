/**
 * Where to send a user after an auth step, taken from a `next` value
 * the client controls. Only same-origin absolute paths are honoured —
 * "//evil.com" and "/\evil.com" are protocol-relative / backslash
 * tricks browsers treat as another origin — so this can't be used as
 * an open redirect.
 */
export function safeNextPath(raw: unknown, fallback = "/dashboard"): string {
  if (typeof raw !== "string") return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return fallback;
  }
  return raw;
}
