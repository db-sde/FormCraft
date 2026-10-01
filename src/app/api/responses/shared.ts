import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveClientIp } from "@/lib/http/ip";

/** Consistent error shape across every route handler — see docs/api.md. */
export function apiError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** The client address for rate-limit keying — see @/lib/http/ip for how
 * it is chosen and why the first X-Forwarded-For entry isn't trusted. */
export function getClientIp(request: NextRequest): string {
  return resolveClientIp((name) => request.headers.get(name));
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
