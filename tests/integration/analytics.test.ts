import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  recordAnalyticsEvent,
  listAnalyticsEventsForForm,
  getFunnelSummaryForForm,
  computeFunnelSummary,
} from "@/domains/analytics";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { completeResponse, startResponse } from "@/domains/responses";

/**
 * Exercises the analytics event write/read path (recordAnalyticsEvent
 * -> listAnalyticsEventsForForm -> computeFunnelSummary) against a
 * real local Postgres instance, the same way the public runtime's
 * route handlers do. Requires `supabase start` — see docs/testing.md.
 * POSTHOG_SERVER_API_KEY is intentionally unset in the test env, so
 * this also exercises recordAnalyticsEvent's no-op PostHog path.
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

const testSchema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Analytics test form" },
  theme: {
    primaryColor: "#0f172a",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end_default", title: "Thanks!", isDefault: true }],
  questions: [
    {
      id: "q_name",
      type: "short_text",
      order: 0,
      label: "Name",
      required: false,
      settings: {},
    },
  ],
  logic: [],
};

describe("analytics events (integration)", () => {
  const supabase = admin();
  let userId: string;
  let workspaceId: string;
  let formId: string;
  const testRunId = crypto.randomUUID().slice(0, 8);

  beforeAll(async () => {
    const email = `analytics-test-${testRunId}@example.com`;
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email,
      password: crypto.randomUUID(),
      email_confirm: true,
    });
    if (userError) throw userError;
    userId = userData.user.id;

    const { data: workspace, error: workspaceError } = await supabase
      .from("workspaces")
      .insert({
        name: "Analytics Test Workspace",
        slug: `atw-${testRunId}`,
        owner_id: userId,
      })
      .select("id")
      .single();
    if (workspaceError) throw workspaceError;
    workspaceId = workspace.id;

    await supabase
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: userId, role: "owner" });

    const { data: form, error: formError } = await supabase
      .from("forms")
      .insert({
        workspace_id: workspaceId,
        title: "Test form",
        slug: `analytics-form-${testRunId}`,
        created_by: userId,
      })
      .select("id")
      .single();
    if (formError) throw formError;
    formId = form.id;

    await supabase.from("form_versions").insert({
      form_id: formId,
      status: "draft",
      version_number: 1,
      schema: testSchema as unknown as Json,
    });
    // Starts are real responses, which need a live version.
    await supabase.rpc("publish_form_version", {
      target_form_id: formId,
      compiled_schema: testSchema as unknown as Json,
    });
  });

  afterAll(async () => {
    if (workspaceId) await supabase.from("workspaces").delete().eq("id", workspaceId);
    if (userId) await supabase.auth.admin.deleteUser(userId);
  });

  it("records events, and the funnel counts views from events but starts and completions from real responses", async () => {
    await recordAnalyticsEvent(supabase, { formId, eventType: "form_viewed" });
    await recordAnalyticsEvent(supabase, { formId, eventType: "form_viewed" });

    // Three people start; one finishes.
    const finished = await startResponse(supabase, formId);
    await startResponse(supabase, formId);
    await startResponse(supabase, formId);
    await completeResponse(
      supabase,
      finished.responseId,
      1,
      "q_name",
      { q_name: "Ada" },
      crypto.randomUUID(),
    );

    const events = await listAnalyticsEventsForForm(supabase, formId);
    expect(events.length).toBe(2);

    const funnel = await getFunnelSummaryForForm(supabase, formId);
    expect(funnel).toEqual({
      views: 2,
      starts: 3,
      completions: 1,
      completionRate: (1 / 3) * 100,
    });

    // The pure helper agrees on the event-derived part.
    expect(computeFunnelSummary(events).views).toBe(2);
  });

  it("stays consistent with the response lists: deleting a response removes it from the funnel", async () => {
    const before = await getFunnelSummaryForForm(supabase, formId);
    const extra = await startResponse(supabase, formId);
    await completeResponse(
      supabase,
      extra.responseId,
      1,
      "q_name",
      { q_name: "Temp" },
      crypto.randomUUID(),
    );
    const during = await getFunnelSummaryForForm(supabase, formId);
    expect(during.starts).toBe(before.starts + 1);
    expect(during.completions).toBe(before.completions + 1);

    await supabase.from("responses").delete().eq("id", extra.responseId);
    expect(await getFunnelSummaryForForm(supabase, formId)).toEqual(before);
  });

  it("limits the funnel to the selected period, by when responses started", async () => {
    const old = await startResponse(supabase, formId);
    await supabase
      .from("responses")
      .update({ started_at: new Date(Date.now() - 40 * 86_400_000).toISOString() })
      .eq("id", old.responseId);

    const all = await getFunnelSummaryForForm(supabase, formId);
    const lastMonth = await getFunnelSummaryForForm(
      supabase,
      formId,
      new Date(Date.now() - 30 * 86_400_000),
    );
    expect(all.starts - lastMonth.starts).toBe(1);
    expect(lastMonth.completionRate).toBeLessThanOrEqual(100);
  });

  it("excludes preview-tagged views from the funnel even though they're still recorded", async () => {
    const before = await getFunnelSummaryForForm(supabase, formId);
    await recordAnalyticsEvent(supabase, {
      formId,
      eventType: "form_viewed",
      isPreview: true,
    });

    const events = await listAnalyticsEventsForForm(supabase, formId);
    expect(events.filter((e) => e.isPreview)).toHaveLength(1);
    expect(await getFunnelSummaryForForm(supabase, formId)).toEqual(before);
  });
});
