import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { supabaseEnv } from "./env";

/** Server-side Supabase client, bound to the current request's cookies.
 * Use in server components, server actions, and route handlers for
 * anything that should run as the authenticated user (RLS-scoped). */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseEnv.url, supabaseEnv.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll is called from a Server Component in some paths where
          // cookies() is read-only; safe to ignore since middleware
          // refreshes the session on every request.
        }
      },
    },
  });
}
