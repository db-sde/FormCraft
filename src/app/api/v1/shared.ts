import { NextResponse, type NextRequest } from "next/server";
import { authenticateApiKey, type ApiCaller, type ApiScope } from "@/domains/api";
import { notifyDailyCap, takeApiRequest, type ApiTake } from "@/domains/api/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { hitRateLimit } from "@/domains/abuse";
import { resolveClientIp } from "@/lib/http/ip";

export function apiError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Failed key attempts allowed per address each minute. */
const BAD_KEY_LIMIT = 30;

/** A paid-only setting asked for through the API on a plan without it
 * (developer spec item 5): 403, naming the plan needed. */
export function planRequired(message: string, plan: string) {
  return NextResponse.json(
    { error: { code: "plan_required", message, plan } },
    { status: 403 },
  );
}

/** The rate-limit headers every authenticated /api/v1 response carries.
 * `Limit` is the bucket `Remaining` counts down (the burst), so
 * Remaining never exceeds it (QA FC15-20); the bucket refills at the
 * per-minute rate, given as `X-RateLimit-Rate`. */
function withLimitHeaders(
  response: Response,
  take: ApiTake,
  caller?: Pick<ApiCaller, "burst">,
): Response {
  if (take.limit !== null) {
    response.headers.set(
      "X-RateLimit-Limit",
      String(Math.max(caller?.burst ?? take.limit, take.remaining)),
    );
    response.headers.set("X-RateLimit-Rate", `${take.limit}/minute`);
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
  /** The permission the call needs; null for any key (connection test). */
  scope: ApiScope | null,
  handler: (
    caller: ApiCaller,
    admin: ReturnType<typeof createAdminClient>,
  ) => Promise<Response>,
): Promise<Response> {
  const admin = createAdminClient();
  const caller = await authenticateApiKey(admin, request.headers.get("authorization"));
  if (!caller) {
    // Wrong keys are counted per address (QA FC15-03): guessing is
    // hopeless with keys this long, but it shouldn't cost nothing.
    const failures = await hitRateLimit(
      admin,
      `api-bad-key:${resolveClientIp((name) => request.headers.get(name))}`,
      BAD_KEY_LIMIT,
      60_000,
    );
    if (!failures.allowed) {
      return NextResponse.json(
        {
          error: "rate_limited",
          scope: "minute",
          retry_after: 60,
          message: "Too many requests with an invalid API key. Wait a minute.",
        },
        {
          status: 429,
          headers: {
            "Retry-After": "60",
            "X-RateLimit-Limit": String(BAD_KEY_LIMIT),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": "60",
          },
        },
      );
    }
    return apiError("unauthorized", "A valid API key is required.", 401);
  }
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
    return withLimitHeaders(response, take, caller);
  }
  if (scope && !caller.scopes.includes(scope)) {
    return withLimitHeaders(
      apiError("forbidden", `This key doesn't have the ${scope} permission.`, 403),
      take,
      caller,
    );
  }
  try {
    return withLimitHeaders(await handler(caller, admin), take, caller);
  } catch {
    return withLimitHeaders(
      apiError("unknown", "Something went wrong.", 500),
      take,
      caller,
    );
  }
}
