import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";

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

  // The test's page can still have a request in flight (e.g. a dashboard
  // render that lazily creates the default workspace) which recreates a
  // workspace after we deleted them — so re-sweep and retry a few times.
  for (let attempt = 1; ; attempt += 1) {
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
    if (!error) return;
    if (attempt >= 3) throw error;
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Marks the first-run welcome dialog as seen for this page. It's modal,
 * so left open it hides the rest of the dashboard from assertions. */
export async function skipWelcomeDialog(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("fc-welcome-seen", "1");
    } catch {
      // Storage can be unavailable; the dialog then just shows.
    }
  });
}

/** Logs in through the form. The first-run welcome dialog is marked seen
 * (it's modal, so it would hide the page from every later assertion)
 * unless `welcome: true` asks to see it. */
export async function loginViaUI(
  page: Page,
  email: string,
  password: string,
  { welcome = false }: { welcome?: boolean } = {},
) {
  if (!welcome) await skipWelcomeDialog(page);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

/**
 * Creates and publishes a form straight through the database, for specs
 * about the respondent side that shouldn't depend on builder UI. Makes
 * the user's workspace too if they haven't logged in yet.
 */
export async function createPublishedForm(
  user: { userId: string },
  schema: FormSchemaV1,
): Promise<{ formId: string; liveLink: string }> {
  const admin = adminClient();
  const unique = crypto.randomUUID().slice(0, 8);

  let { data: workspace } = await admin
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.userId)
    .limit(1)
    .maybeSingle();
  if (!workspace) {
    const { data, error } = await admin
      .from("workspaces")
      .insert({ name: "E2E workspace", slug: `e2e-${unique}`, owner_id: user.userId })
      .select("id")
      .single();
    if (error) throw error;
    workspace = data;
    await admin
      .from("workspace_members")
      .insert({ workspace_id: workspace.id, user_id: user.userId, role: "owner" });
  }

  const slug = `e2e-form-${unique}`;
  const { data: form, error: formError } = await admin
    .from("forms")
    .insert({
      workspace_id: workspace.id,
      title: schema.meta.title,
      slug,
      created_by: user.userId,
    })
    .select("id")
    .single();
  if (formError) throw formError;

  const json = schema as unknown as Json;
  await admin
    .from("form_versions")
    .insert({ form_id: form.id, status: "draft", version_number: 1, schema: json });
  const { error: publishError } = await admin.rpc("publish_form_version", {
    target_form_id: form.id,
    compiled_schema: json,
  });
  if (publishError) throw publishError;

  return { formId: form.id, liveLink: `/f/${slug}` };
}

/** Clicks Publish in the builder, waits for the "Published." toast and
 * returns the live link from the Share popover (then closes it). */
export async function publishFromBuilder(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByText("Published.", { exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Share" }).click();
  const href = await page
    .getByRole("link", { name: "Open live form" })
    .getAttribute("href");
  await page.keyboard.press("Escape");
  if (!href) throw new Error("no live link in the Share popover");
  return href;
}

/** From the empty dashboard: "Start from scratch", through the welcome
 * dialog when it's open, and into the builder. */
export async function startFromScratch(page: Page) {
  const dialog = page.getByRole("dialog", { name: "How do you want to start?" });
  if (await dialog.isVisible()) {
    await dialog.getByRole("radio", { name: /Start from scratch/ }).click();
    await dialog.getByRole("button", { name: "Create blank form" }).click();
  } else {
    await page.getByRole("button", { name: "Start from scratch" }).click();
  }
  await page.waitForURL(/\/forms\/[0-9a-f-]{36}$/);
}

/** Waits for the builder's autosave to finish a real round trip. */
export async function waitForSaved(page: Page) {
  await expect(page.locator('[data-save-state="saved"]')).toBeVisible({ timeout: 15000 });
}

/** Adds a question from the builder's Add question menu. */
export async function addQuestion(page: Page, type: string) {
  await page.getByRole("button", { name: "Add question" }).click();
  await page.getByRole("button", { name: new RegExp(`^${type}`) }).click();
}

export async function logOutViaUI(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await page.waitForURL("**/login");
}
