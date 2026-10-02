import { NextResponse, type NextRequest } from "next/server";
import { authenticateApiKey, type ApiCaller, type ApiScope } from "@/domains/api";
import { hitRateLimit } from "@/domains/abuse/shared-rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export function apiError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * The /api/v1 surface (Zapier / Make): `Authorization: Bearer fc_live_…`,
 * scoped to the key's workspace, 120 requests a minute per key. Every
 * query below filters by the caller's workspace explicitly — this runs
 * with the service role, so nothing else would.
 */
export async function withApiKey(
  request: NextRequest,
  scope: ApiScope,
  handler: (
    caller: ApiCaller,
    admin: ReturnType<typeof createAdminClient>,
  ) => Promise<Response>,
): Promise<Response> {
  const admin = createAdminClient();
  const caller = await authenticateApiKey(admin, request.headers.get("authorization"));
  if (!caller) return apiError("unauthorized", "A valid API key is required.", 401);
  if (!caller.scopes.includes(scope)) {
    return apiError("forbidden", `This key doesn't have the ${scope} permission.`, 403);
  }
  if (!(await hitRateLimit(admin, `api:${caller.keyId}`, 120, 60_000)).allowed) {
    return apiError("rate_limited", "Too many requests. Slow down a little.", 429);
  }
  try {
    return await handler(caller, admin);
  } catch {
    return apiError("unknown", "Something went wrong.", 500);
  }
}
