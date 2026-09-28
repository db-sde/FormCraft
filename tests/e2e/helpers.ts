import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Creates a real, already-email-confirmed user via the GoTrue admin
 * API (never a raw `auth.users` INSERT — a hand-crafted row is missing
 * fields GoTrue's own login path expects and silently fails to
 * authenticate; a real bug hit while live-testing this session, see
 * DECISIONS.md). Every E2E spec that needs a logged-in creator uses
 * this instead of walking the actual signup + email-confirmation flow,
 * which would require a real inbox — auth.spec.ts covers the signup
 * *form* itself separately, without completing confirmation.
 */
export function adminClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set for E2E tests",
    );
  }
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

export async function createConfirmedUser(prefix: string) {
  const admin = adminClient();
  const unique = crypto.randomUUID().slice(0, 8);
  const email = `${prefix}-${unique}@example.com`;
  const password = `Test-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // ensureDefaultWorkspace derives the workspace slug from
    // full_name, falling back to the fixed "my-workspace" (then
    // "-1".."-4") pool when it's unset — every unnamed E2E user would
    // collide on that same 5-slug pool under any real parallelism,
    // since `workspaces.slug` is globally unique. A per-test unique
    // name sidesteps that entirely rather than relying on cleanup
    // ordering across parallel workers.
    user_metadata: { full_name: `${prefix}-${unique}` },
  });
  if (error) throw error;
  return { userId: data.user.id, email, password };
}

/** Deletes everything a test user created, not just the auth row —
 * `workspaces.owner_id` is `on delete restrict` (deliberately: the app
 * never silently orphans/cascades away a workspace via a user
 * deletion), so deleting the user first would fail. Cleans up
 * workspaces (which cascades to their forms/members) before the user
 * itself, and surfaces any failure instead of swallowing it, so a
 * broken cleanup shows up as a loud test failure rather than silently
 * leaking rows that break a later run. */
export async function deleteUser(userId: string) {
  const admin = adminClient();

  const { data: workspaces, error: listError } = await admin
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId);
  if (listError) throw listError;

  for (const workspace of workspaces ?? []) {
    const { error } = await admin.from("workspaces").delete().eq("id", workspace.id);
    if (error) throw error;
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw error;
}

export async function loginViaUI(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}
