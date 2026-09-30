import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { checkRateLimit } from "./rate-limit";

/**
 * Rate limit shared by every server instance (Postgres hit_rate_limit),
 * so a scaled deployment enforces one budget per key rather than one
 * per process. Needs the service-role client. If the database call
 * fails, falls back to the per-process limiter rather than either
 * blocking everyone or dropping protection entirely.
 */
export async function hitRateLimit(
  admin: SupabaseClient<Database>,
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean }> {
  const { data, error } = await admin.rpc("hit_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: Math.ceil(windowMs / 1000),
  });
  if (error || typeof data !== "boolean") {
    return { allowed: checkRateLimit(key, limit, windowMs).allowed };
  }
  return { allowed: data };
}

/** Drops rate-limit rows whose windows ended long ago (retention cron). */
export async function pruneRateLimits(admin: SupabaseClient<Database>): Promise<void> {
  const cutoff = new Date(Date.now() - 86_400_000).toISOString();
  await admin.from("rate_limits").delete().lt("window_start", cutoff);
}
