import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Consistent error shape across every route handler — see docs/api.md. */
export function apiError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Best-effort client IP for rate-limit keying. Not spoof-proof behind
 * an untrusted proxy, but this deployment sits behind a single known
 * reverse proxy (or none, locally) — good enough for a bounded
 * single-instance limiter, not a security boundary on its own. */
export function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

const MAX_BODY_BYTES = 200_000;

/** Parses the request body as JSON, rejecting oversized payloads before
 * ever handing them to Zod — a public endpoint must not let an
 * arbitrarily large body reach validation. */
export async function readJsonBody(request: NextRequest): Promise<unknown | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) return null;

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  if (text.length === 0) return {};

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
