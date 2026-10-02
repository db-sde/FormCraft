import "server-only";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { needsSecondFactor } from "@/domains/identity/mfa";

/**
 * Establishes the current identity server-side. This is the actual
 * authorization boundary for protected server components/actions —
 * the proxy's redirect is a UX convenience only (see
 * src/lib/supabase/middleware.ts), never the thing being relied on for
 * security.
 */
export async function requireUser() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }
  // Enrolled in 2FA (P3.13) but only past the password so far. The
  // database refuses workspace data to such a session regardless.
  if (await needsSecondFactor(supabase)) {
    redirect("/two-factor");
  }

  return { supabase, user };
}
