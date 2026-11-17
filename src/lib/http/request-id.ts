/**
 * One id per request (foundations §1), so a respondent's submit, the log
 * line it wrote, the audit entry and the analytics event can be matched
 * up. The proxy sets it on every request (and on the response, as
 * X-Request-Id); server code reads it here. A browser can't choose it:
 * whatever arrives in the header is replaced. On Vercel it's Vercel's own
 * request id, so it also matches the platform's logs.
 */
export const REQUEST_ID_HEADER = "x-request-id";

const VERCEL_ID = /^[A-Za-z0-9:_-]{8,120}$/;

/** The id for an incoming request: Vercel's when it's there, else new. */
export function newRequestId(headers: Headers): string {
  const vercel = headers.get("x-vercel-id");
  return vercel && VERCEL_ID.test(vercel) ? vercel : crypto.randomUUID();
}

/** The current request's id, or null outside a request (a script, a
 * background job, a test). Never throws. */
export async function currentRequestId(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    return (await headers()).get(REQUEST_ID_HEADER);
  } catch {
    return null;
  }
}
