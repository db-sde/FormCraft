import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveClientIp } from "@/lib/http/ip";
import type { Database } from "@/lib/supabase/database.types";
import { isWriteSecretFor, WRITE_SECRET_COOKIE } from "@/domains/responses/write-secret";

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

/**
 * Refuses a write to a response from anyone without its write secret
 * (QA FC4-14). Null when the write may go ahead: the cookie matches, the
 * response predates secrets, or it doesn't exist (the route's own 404).
 */
export async function writeDenied(
  request: NextRequest,
  admin: SupabaseClient<Database>,
  responseId: string,
): Promise<NextResponse | null> {
  if (isWriteSecretFor(responseId, request.cookies.get(WRITE_SECRET_COOKIE)?.value)) {
    return null;
  }
  const { data } = await admin
    .from("responses")
    .select("write_protected")
    .eq("id", responseId)
    .maybeSingle();
  if (!data || !data.write_protected) return null;
  return apiError(
    "forbidden",
    "This response can only be changed from the browser that started it.",
    403,
  );
}
