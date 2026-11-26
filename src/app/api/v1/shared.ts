import { NextResponse, type NextRequest } from "next/server";
import { authenticateApiKey, type ApiCaller, type ApiScope } from "@/domains/api";
import { notifyDailyCap, takeApiRequest, type ApiTake } from "@/domains/api/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export function apiError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** A paid-only setting asked for through the API on a plan without it
 * (developer spec item 5): 403, naming the plan needed. */
export function planRequired(message: string, plan: string) {
  return NextResponse.json(
    { error: { code: "plan_required", message, plan } },
    { status: 403 },
  );
}

/** The rate-limit headers every /api/v1 response carries. */
function withLimitHeaders(response: Response, take: ApiTake): Response {
  if (take.limit !== null) {
    response.headers.set("X-RateLimit-Limit", String(take.limit));
    response.headers.set("X-RateLimit-Remaining", String(take.remaining));
    response.headers.set("X-RateLimit-Reset", String(take.reset));
  }
  if (take.daily_remaining !== null) {
    response.headers.set("X-RateLimit-Daily-Remaining", String(take.daily_remaining));
  }
  return response;
}

/**
 * The /api/v1 surface (Zapier / Make / n8n): `Authorization: Bearer
 * fc_live_…`, scoped to the key's workspace, within the plan's limits
 * (developer spec item 5: a token bucket and a daily cap per workspace,
 * across all its keys, held in the database so every instance agrees).
 * Every query below filters by the caller's workspace explicitly — this
 * runs with the service role, so nothing else would.
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
  // Suspended by FormCraft (Super Admin): the API is closed to it too.
  const { data: ws } = await admin
    .from("workspaces")
    .select("status")
    .eq("id", caller.workspaceId)
    .maybeSingle();
  if (ws?.status === "suspended") {
    return apiError("workspace_suspended", "This workspace is suspended.", 403);
  }
  const take = await takeApiRequest(admin, caller);
  if (!take.allowed) {
    if (take.first_day_cap)
      await notifyDailyCap(admin, caller.workspaceId, caller.perDay);
    const response = NextResponse.json(
      {
        error: "rate_limited",
        scope: take.scope,
        retry_after: take.retry_after,
        message:
          take.scope === "day"
            ? "This workspace has used today's API requests for its plan. They reset at 00:00 UTC."
            : "Too many requests. Slow down a little.",
      },
      { status: 429, headers: { "Retry-After": String(take.retry_after) } },
    );
    return withLimitHeaders(response, take);
  }
  if (!caller.scopes.includes(scope)) {
    return withLimitHeaders(
      apiError("forbidden", `This key doesn't have the ${scope} permission.`, 403),
      take,
    );
  }
  try {
    return withLimitHeaders(await handler(caller, admin), take);
  } catch {
    return withLimitHeaders(apiError("unknown", "Something went wrong.", 500), take);
  }
}
