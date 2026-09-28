import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { getPublicFormBySlug, createFormWithDraft } from "@/domains/forms";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";

/**
 * Regression test for a real bug found via live browser verification:
 * the RLS policies that let the public runtime (/f/[slug]) read a
 * published form were scoped `to anon` only. Every prior integration
 * test in this suite uses the service-role client, which bypasses RLS
 * entirely — so this exact bug shipped past the whole test suite and
 * was only caught by clicking through the app in a real, logged-in
 * browser session (see PROJECT_STATUS.md / migration
 * 00000000000011_public_form_read_for_authenticated.sql). This test
 * uses the anon-key client and a real signed-in session, the same way
 * createServerSupabaseClient() does in the app, specifically so RLS is
 * actually exercised rather than bypassed.
 */

function admin(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set for integration tests",
    );
  }
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

function anonClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set for integration tests",
    );
  }
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

const testSchema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Public access test form" },
  theme: {
    primaryColor: "#0f172a",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end_default", title: "Thanks!", isDefault: true }],
  questions: [
    {
      id: "q1",
      type: "short_text",
      order: 0,
      label: "Q1",
      required: false,
      settings: {},
    },
  ],
  logic: [],
};

describe("public form access (real RLS, not bypassed)", () => {
  const supabaseAdmin = admin();
  let ownerUserId: string;
  let unrelatedUserId: string;
  let unrelatedUserEmail: string;
  let unrelatedUserPassword: string;
  let workspaceId: string;
  let formId: string;
  let draftOnlyFormId: string;
  const testRunId = crypto.randomUUID().slice(0, 8);

  beforeAll(async () => {
    const ownerEmail = `public-access-owner-${testRunId}@example.com`;
    const { data: ownerData, error: ownerError } =
      await supabaseAdmin.auth.admin.createUser({
        email: ownerEmail,
        password: crypto.randomUUID(),
        email_confirm: true,
      });
    if (ownerError) throw ownerError;
    ownerUserId = ownerData.user.id;

    unrelatedUserEmail = `public-access-visitor-${testRunId}@example.com`;
    unrelatedUserPassword = crypto.randomUUID();
    const { data: visitorData, error: visitorError } =
      await supabaseAdmin.auth.admin.createUser({
        email: unrelatedUserEmail,
        password: unrelatedUserPassword,
        email_confirm: true,
      });
    if (visitorError) throw visitorError;
    unrelatedUserId = visitorData.user.id;

    const { data: workspace, error: workspaceError } = await supabaseAdmin
      .from("workspaces")
      .insert({
        name: "Public Access Test Workspace",
        slug: `patw-${testRunId}`,
        owner_id: ownerUserId,
      })
      .select("id")
      .single();
    if (workspaceError) throw workspaceError;
    workspaceId = workspace.id;

    await supabaseAdmin
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: ownerUserId, role: "owner" });

    const { data: form, error: formError } = await supabaseAdmin
      .from("forms")
      .insert({
        workspace_id: workspaceId,
        title: "Public access test form",
        slug: `public-access-form-${testRunId}`,
        created_by: ownerUserId,
      })
      .select("id")
      .single();
    if (formError) throw formError;
    formId = form.id;

    await supabaseAdmin.from("form_versions").insert({
      form_id: formId,
      status: "draft",
      version_number: 1,
      schema: testSchema as unknown as Json,
    });
    await supabaseAdmin.rpc("publish_form_version", {
      target_form_id: formId,
      compiled_schema: testSchema as unknown as Json,
    });

    const { data: draftOnlyForm, error: draftOnlyFormError } = await supabaseAdmin
      .from("forms")
      .insert({
        workspace_id: workspaceId,
        title: "Draft-only form",
        slug: `draft-only-form-${testRunId}`,
        created_by: ownerUserId,
      })
      .select("id")
      .single();
    if (draftOnlyFormError) throw draftOnlyFormError;
    draftOnlyFormId = draftOnlyForm.id;
    await supabaseAdmin.from("form_versions").insert({
      form_id: draftOnlyFormId,
      status: "draft",
      version_number: 1,
      schema: testSchema as unknown as Json,
    });
  });

  afterAll(async () => {
    if (workspaceId)
      await supabaseAdmin.from("workspaces").delete().eq("id", workspaceId);
    if (ownerUserId) await supabaseAdmin.auth.admin.deleteUser(ownerUserId);
    if (unrelatedUserId) await supabaseAdmin.auth.admin.deleteUser(unrelatedUserId);
  });

  it("an anonymous (logged-out) visitor can read the published form", async () => {
    const anon = anonClient();
    const result = await getPublicFormBySlug(anon, `public-access-form-${testRunId}`);
    expect(result).not.toBeNull();
    expect(result?.formId).toBe(formId);
  });

  it("a signed-in user with no relationship to this form can still read it — the regression this migration fixes", async () => {
    const visitor = anonClient();
    const { error: signInError } = await visitor.auth.signInWithPassword({
      email: unrelatedUserEmail,
      password: unrelatedUserPassword,
    });
    expect(signInError).toBeNull();

    const result = await getPublicFormBySlug(visitor, `public-access-form-${testRunId}`);
    expect(result).not.toBeNull();
    expect(result?.formId).toBe(formId);
  });

  it("neither an anonymous nor a signed-in stranger can read a draft-only (unpublished) form", async () => {
    const anon = anonClient();
    expect(await getPublicFormBySlug(anon, `draft-only-form-${testRunId}`)).toBeNull();

    const visitor = anonClient();
    await visitor.auth.signInWithPassword({
      email: unrelatedUserEmail,
      password: unrelatedUserPassword,
    });
    expect(await getPublicFormBySlug(visitor, `draft-only-form-${testRunId}`)).toBeNull();
  });
});

/**
 * Regression test for a real bug found via a real E2E test run (two
 * Playwright workers in parallel, each creating a form titled
 * "Untitled form" — the literal default every new form starts with):
 * `forms.slug` was only unique *within* a workspace
 * (unique(workspace_id, slug)), but getPublicFormBySlug looks up a
 * form by slug alone with no workspace to disambiguate — so two
 * different workspaces both leaving a form as "Untitled form" (highly
 * likely, not a contrived edge case) made the public URL lookup match
 * more than one row and 500 with PGRST116 ("multiple rows returned").
 * Fixed in migration 00000000000012 by making `forms.slug` globally
 * unique, matching `workspaces.slug`'s own design — see DECISIONS.md.
 */
describe("forms.slug is globally unique (not just per-workspace)", () => {
  const supabaseAdmin = admin();
  let userId: string;
  let workspaceAId: string;
  let workspaceBId: string;
  const testRunId = crypto.randomUUID().slice(0, 8);

  beforeAll(async () => {
    const email = `slug-uniqueness-${testRunId}@example.com`;
    const { data: userData, error: userError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password: crypto.randomUUID(),
        email_confirm: true,
      });
    if (userError) throw userError;
    userId = userData.user.id;

    const { data: workspaceA, error: workspaceAError } = await supabaseAdmin
      .from("workspaces")
      .insert({ name: "Slug Test A", slug: `slug-test-a-${testRunId}`, owner_id: userId })
      .select("id")
      .single();
    if (workspaceAError) throw workspaceAError;
    workspaceAId = workspaceA.id;

    const { data: workspaceB, error: workspaceBError } = await supabaseAdmin
      .from("workspaces")
      .insert({ name: "Slug Test B", slug: `slug-test-b-${testRunId}`, owner_id: userId })
      .select("id")
      .single();
    if (workspaceBError) throw workspaceBError;
    workspaceBId = workspaceB.id;

    await supabaseAdmin.from("workspace_members").insert([
      { workspace_id: workspaceAId, user_id: userId, role: "owner" },
      { workspace_id: workspaceBId, user_id: userId, role: "owner" },
    ]);
  });

  afterAll(async () => {
    if (workspaceAId)
      await supabaseAdmin.from("workspaces").delete().eq("id", workspaceAId);
    if (workspaceBId)
      await supabaseAdmin.from("workspaces").delete().eq("id", workspaceBId);
    if (userId) await supabaseAdmin.auth.admin.deleteUser(userId);
  });

  it("createFormWithDraft in a second workspace auto-suffixes the slug instead of colliding", async () => {
    const first = await createFormWithDraft(
      supabaseAdmin,
      workspaceAId,
      userId,
      "Untitled form",
    );
    const second = await createFormWithDraft(
      supabaseAdmin,
      workspaceBId,
      userId,
      "Untitled form",
    );
    expect(second.id).not.toBe(first.id);

    const { data: forms } = await supabaseAdmin
      .from("forms")
      .select("id, slug")
      .in("id", [first.id, second.id]);
    const slugs = (forms ?? []).map((f) => f.slug);
    expect(new Set(slugs).size).toBe(2);

    // And the public lookup for each slug now resolves unambiguously
    // to exactly the right form.
    for (const form of forms ?? []) {
      const resolved = await getPublicFormBySlug(supabaseAdmin, form.slug);
      // Neither form is published, so this just proves the query
      // itself doesn't throw PGRST116 for "multiple rows" — the bug
      // this migration fixes would throw before ever reaching the
      // "not published" null-return path.
      expect(resolved).toBeNull();
    }
  });
});
