import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { supabaseEnv } from "./env";

/**
 * Service-role Supabase client. Bypasses RLS entirely — use ONLY for
 * operations that have already passed the app-level auth/authorization
 * sequence described in ARCHITECTURE.md (e.g. the public respondent
 * runtime, which never holds a user session). Never import this into
 * anything that could run in a client component.
 */
export function createAdminClient() {
  return createClient<Database>(supabaseEnv.url, supabaseEnv.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
