"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { supabaseEnv } from "./env";

/** Browser-side Supabase client. Uses the anon key only — never the
 * service role key, which must not reach client bundles. */
export function createClient() {
  return createBrowserClient<Database>(supabaseEnv.url, supabaseEnv.anonKey);
}
