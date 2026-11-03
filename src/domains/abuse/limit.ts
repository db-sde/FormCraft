import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hitRateLimit } from "./shared-rate-limit";

/**
 * The shared rate limit (see shared-rate-limit.ts) without handing the
 * caller a service-role client: only the limiter's own function is used.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean }> {
  return hitRateLimit(createAdminClient(), key, limit, windowMs);
}
