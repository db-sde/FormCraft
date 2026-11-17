import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  enqueueAbandonedEvents,
  enqueuePartialSaveEvents,
  enqueueWebhookDeliveries,
  PARTIAL_WINDOW_MS,
} from "@/domains/webhooks";

/**
 * Partial-response webhooks (F-53, migration 63) against the real
 * database: which events are queued, when, and never twice. Nothing is
 * dispatched here (webhook-workers.test.ts owns the delivery sweep), so
 * parallel files never take each other's jobs.
 */
const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().slice(0, 8);

const schema = {
  schemaVersion: 1,
  meta: { title: "Partial hooks" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "q_name",
      type: "short_text",
      order: 0,
      label: "Name",
      required: false,
      settings: {},
    },
    {
      id: "q_city",
      type: "short_text",
      order: 1,
      label: "City",
      required: false,
      settings: {},
    },
  ],
  logic: [],
} as unknown as Json;

let userId: string;
let workspaceId: string;
let formId: string;
let versionId: string;
let allEvents: string;
let completedOnly: string;

async function endpoint(config: Json, kind = "n8n") {
  const { data, error } = await admin
    .from("webhook_endpoints")
    .insert({
      form_id: formId,
      url: "https://n8n.example.com/webhook/formcraft",
      signing_secret: "whsec_test",
      kind,
      config,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function partialResponse(answers: Record<string, string>, form = formId) {
  const version =
    form === formId
      ? versionId
      : (
          await admin
            .from("form_versions")
            .select("id")
            .eq("form_id", form)
            .eq("status", "published")
            .single()
        ).data!.id;
  const { data: r, error } = await admin
    .from("responses")
    .insert({ form_id: form, form_version_id: version, status: "partial" })
    .select("id")
    .single();
  if (error) throw error;
  await setAnswers(r.id, answers);
  return r.id;
}

async function setAnswers(responseId: string, answers: Record<string, string>) {
  for (const [question_id, value] of Object.entries(answers)) {
    await admin.from("answers").upsert(
      { response_id: responseId, question_id, value },
      {
        onConflict: "response_id,question_id",
      },
    );
  }
}

const deliveries = async (endpointId: string, responseId: string) =>
  (
    await admin
      .from("webhook_deliveries")
      .select("event_id, event_type, dedupe_key, payload, status")
      .eq("endpoint_id", endpointId)
      .eq("response_id", responseId)
      .order("created_at")
  ).data ?? [];

async function publishedForm(savePartial: boolean, slug: string) {
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Partial hooks",
      slug,
      created_by: userId,
      save_partial_responses: savePartial,
    })
    .select("id")
    .single();
  const { error } = await admin.rpc("publish_form_version", {
    target_form_id: form!.id,
    compiled_schema: schema,
  });
  if (error) throw error;
  return form!.id;
}

beforeAll(async () => {
  const { data: user } = await admin.auth.admin.createUser({
    email: `partial-${runId}@example.com`,
    password: `Pw-${crypto.randomUUID()}`,
    email_confirm: true,
  });
  userId = user.user!.id;
  const { data: ws } = await admin
    .from("workspaces")
    .insert({ name: "Partial", slug: `partial-${runId}`, owner_id: userId })
    .select("id")
    .single();
  workspaceId = ws!.id;
  formId = await publishedForm(true, `partial-${runId}`);
  versionId = (
    await admin
      .from("form_versions")
      .select("id")
      .eq("form_id", formId)
      .eq("status", "published")
      .single()
  ).data!.id;
  allEvents = await endpoint({
    events: [
      "response.completed",
      "response.partial_saved",
      "response.abandoned",
      "response.resumed",
    ],
    abandonAfterMinutes: 30,
  });
  // Added a while ago: the idle sweep ignores responses that went quiet
  // before an endpoint existed.
  await admin
    .from("webhook_endpoints")
    .update({ created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString() })
    .eq("id", allEvents);
  // An endpoint that never chose: completed responses only, as before.
  completedOnly = await endpoint({}, "webhook");
});

afterAll(async () => {
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("partial-response webhooks (F-53)", () => {
  it("coalesce a burst of saves into one event with the latest answers", async () => {
    const responseId = await partialResponse({ q_name: "Ada" });
    const at = new Date(
      Math.floor(Date.now() / PARTIAL_WINDOW_MS) * PARTIAL_WINDOW_MS + 1000,
    );
    expect(await enqueuePartialSaveEvents(admin, responseId, at)).toBe(1);
    await setAnswers(responseId, { q_city: "Pune" });
    expect(
      await enqueuePartialSaveEvents(admin, responseId, new Date(at.getTime() + 5000)),
    ).toBe(0);

    const rows = await deliveries(allEvents, responseId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_type: "response.partial_saved",
      status: "pending",
    });
    expect((rows[0].payload as { answers: unknown }).answers).toEqual({
      q_name: "Ada",
      q_city: "Pune",
    });
    expect((rows[0].payload as { eventId: string }).eventId).toBe(rows[0].event_id);
    // The endpoint that didn't choose partial events got nothing.
    expect(await deliveries(completedOnly, responseId)).toHaveLength(0);

    // The next window is a new event.
    expect(
      await enqueuePartialSaveEvents(
        admin,
        responseId,
        new Date(at.getTime() + PARTIAL_WINDOW_MS),
      ),
    ).toBe(1);
  });

  it("send abandoned once per idle spell, and resumed once when they come back", async () => {
    const responseId = await partialResponse({ q_name: "Bo" });
    const idleSince = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    await admin
      .from("responses")
      .update({ last_active_at: idleSince })
      .eq("id", responseId);

    await enqueueAbandonedEvents(admin);
    await enqueueAbandonedEvents(admin);
    let rows = (await deliveries(allEvents, responseId)).filter(
      (d) => d.event_type === "response.abandoned",
    );
    expect(rows).toHaveLength(1);
    const abandonedId = rows[0].event_id;

    // Back again: one resumed event, however many saves follow.
    await admin
      .from("responses")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", responseId);
    await enqueuePartialSaveEvents(admin, responseId);
    await enqueuePartialSaveEvents(admin, responseId);
    rows = await deliveries(allEvents, responseId);
    expect(rows.filter((d) => d.event_type === "response.resumed")).toHaveLength(1);
    // Not idle any more: no second abandoned event.
    await enqueueAbandonedEvents(admin);
    rows = await deliveries(allEvents, responseId);
    expect(rows.filter((d) => d.event_type === "response.abandoned")).toEqual([
      expect.objectContaining({ event_id: abandonedId }),
    ]);
  });

  it("are never sent for a form that doesn't keep unfinished responses", async () => {
    const privateForm = await publishedForm(false, `partial-off-${runId}`);
    const { data: hook } = await admin
      .from("webhook_endpoints")
      .insert({
        form_id: privateForm,
        url: "https://n8n.example.com/webhook/x",
        signing_secret: "whsec_test",
        kind: "n8n",
        config: { events: ["response.partial_saved", "response.abandoned"] },
        created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      })
      .select("id")
      .single();
    const responseId = await partialResponse({ q_name: "Cy" }, privateForm);
    await admin
      .from("responses")
      .update({ last_active_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString() })
      .eq("id", responseId);
    expect(await enqueuePartialSaveEvents(admin, responseId)).toBe(0);
    await enqueueAbandonedEvents(admin);
    expect(await deliveries(hook!.id, responseId)).toHaveLength(0);
  });

  it("don't stand in for the completed delivery the recovery sweep looks for", async () => {
    const responseId = await partialResponse({ q_name: "Di" });
    await enqueuePartialSaveEvents(admin, responseId);
    await admin
      .from("responses")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", responseId);
    const { data: missing } = await admin.rpc("responses_missing_webhook_delivery", {
      p_limit: 1000,
    });
    const mine = (missing ?? []).filter((m) => m.response_id === responseId);
    // Both endpoints are owed a completed delivery; the partial one doesn't count.
    expect(mine.map((m) => m.endpoint_id).sort()).toEqual(
      [allEvents, completedOnly].sort(),
    );

    expect(await enqueueWebhookDeliveries(admin, responseId)).toBe(2);
    expect(await enqueueWebhookDeliveries(admin, responseId)).toBe(0);
    const completed = (await deliveries(allEvents, responseId)).filter(
      (d) => d.event_type === "response.completed",
    );
    expect(completed).toHaveLength(1);
  });

  it("leave an endpoint that unticked completed without completed responses", async () => {
    const partialOnly = await endpoint({ events: ["response.partial_saved"] });
    const responseId = await partialResponse({ q_name: "Ed" });
    await admin
      .from("responses")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", responseId);
    await enqueueWebhookDeliveries(admin, responseId);
    expect(await deliveries(partialOnly, responseId)).toHaveLength(0);
  });
});
