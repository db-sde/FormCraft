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
  });

  afterAll(async () => {
    if (workspaceId) await supabase.from("workspaces").delete().eq("id", workspaceId);
    if (userId) await supabase.auth.admin.deleteUser(userId);
  });

  it("records events and the dashboard read path feeds a correct funnel summary", async () => {
    await recordAnalyticsEvent(supabase, {
      formId,
      eventType: "form_viewed",
    });
    await recordAnalyticsEvent(supabase, {
      formId,
      eventType: "form_viewed",
    });
    const responseId = crypto.randomUUID();
    await recordAnalyticsEvent(supabase, {
      formId,
      eventType: "form_started",
      sessionId: responseId,
    });
    await recordAnalyticsEvent(supabase, {
      formId,
      eventType: "form_submitted",
      sessionId: responseId,
      metadata: { endingId: "end_default" },
    });

    const events = await listAnalyticsEventsForForm(supabase, formId);
    expect(events.length).toBe(4);

    const funnel = computeFunnelSummary(events);
    expect(funnel.views).toBe(2);
    expect(funnel.starts).toBe(1);
    expect(funnel.completions).toBe(1);
    expect(funnel.completionRate).toBe(100);

    // The dashboard's DB-counted path must agree with the pure one.
    expect(await getFunnelSummaryForForm(supabase, formId)).toEqual(funnel);
  });

  it("excludes preview-tagged events from the funnel even though they're still recorded", async () => {
    await recordAnalyticsEvent(supabase, {
      formId,
      eventType: "form_started",
      isPreview: true,
    });

    const events = await listAnalyticsEventsForForm(supabase, formId);
    const previewEvents = events.filter((e) => e.isPreview);
    expect(previewEvents.length).toBe(1);

    // computeFunnelSummary itself already filters isPreview — this
    // just re-confirms the real, DB-round-tripped rows behave the
    // same way the pure unit tests already prove in isolation.
    const funnelBefore = computeFunnelSummary(events.filter((e) => !e.isPreview));
    const funnelIncludingPreview = computeFunnelSummary(events);
    expect(funnelIncludingPreview).toEqual(funnelBefore);
    expect(await getFunnelSummaryForForm(supabase, formId)).toEqual(funnelBefore);
  });
});
