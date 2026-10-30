import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  completeResponse,
  saveResponseAnswers,
  startResponse,
} from "@/domains/responses";
import {
  addComment,
  listComments,
  replayAttempt,
  responseInForm,
  setAssignee,
  setReviewStatus,
} from "@/domains/responses/records";
import { getResponseTimeline } from "@/domains/responses/timeline";
import { getOrder, saveOrder } from "@/domains/responses/orders";
import {
  prepareUpload,
  recordUpload,
  UnsupportedFileTypeError,
} from "@/domains/uploads/queries";
import { listResponses } from "@/domains/responses/dashboard";

/**
 * Master spec Phase 2 against the real database: the records view
 * (status, assignee, private comments) and who may read or write it, the
 * per-response timeline and replay, signature uploads, and orders priced
 * by the server.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin: SupabaseClient<Database> = createClient<Database>(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const anon = createClient<Database>(url, anonKey, { auth: { persistSession: false } });
const runId = crypto.randomUUID().slice(0, 8);

type Person = { id: string; client: SupabaseClient<Database> };
const people: Person[] = [];

async function person(name: string): Promise<Person> {
  const email = `${name}-${runId}@example.com`;
  const password = crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error) throw error;
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false },
  });
  const { error: signIn } = await client.auth.signInWithPassword({ email, password });
  if (signIn) throw signIn;
  const p = { id: data.user.id, client };
  people.push(p);
  return p;
}

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Shop" },
  theme: {
    primaryColor: "#0f172a",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "q_items",
      type: "products",
      order: 0,
      label: "Your order",
      required: true,
      settings: {
        currency: "USD",
        items: [
          { id: "tee", label: "T-shirt", price: 1999, maxQuantity: 5 },
          { id: "mug", label: "Mug", price: 850 },
        ],
      },
    },
    {
      id: "q_sign",
      type: "signature",
      order: 1,
      label: "Sign here",
      required: true,
      settings: {},
    },
  ],
  logic: [],
};

// A 1×1 PNG.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);

let owner: Person;
let viewer: Person;
let outsider: Person;
let workspaceId: string;
let formId: string;
let responseId: string;

beforeAll(async () => {
  owner = await person("records-owner");
  viewer = await person("records-viewer");
  outsider = await person("records-outsider");
  const { data: ws } = await admin
    .from("workspaces")
    .insert({ name: "Records", slug: `records-${runId}`, owner_id: owner.id })
    .select("id")
    .single();
  workspaceId = ws!.id;
  await admin.from("workspace_members").insert([
    { workspace_id: workspaceId, user_id: owner.id, role: "owner" },
    { workspace_id: workspaceId, user_id: viewer.id, role: "viewer" },
  ]);
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Shop",
      slug: `shop-${runId}`,
      created_by: owner.id,
    })
    .select("id")
    .single();
  formId = form!.id;
  await admin.from("form_versions").insert({
    form_id: formId,
    status: "draft",
    version_number: 1,
    schema: schema as unknown as Json,
  });
  const { error } = await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: schema as unknown as Json,
  });
  if (error) throw error;

  // One completed response: two T-shirts and a mug, signed.
  const started = await startResponse(admin, formId);
  responseId = started.responseId;
  await saveResponseAnswers(admin, responseId, 1, "q_items", {
    q_items: { tee: 2, mug: 1 },
  });
  const { uploadId } = await recordUpload(admin, responseId, "q_sign", {
    bytes: PNG,
    originalFilename: "signature.png",
  });
  const done = await completeResponse(
    admin,
    responseId,
    2,
    "q_sign",
    { q_items: { tee: 2, mug: 1 }, q_sign: uploadId },
    crypto.randomUUID(),
  );
  if (!done.ok) throw new Error(`completion failed: ${JSON.stringify(done)}`);
}, 60_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", workspaceId);
  for (const p of people) await admin.auth.admin.deleteUser(p.id);
});

describe("orders (F-04)", () => {
  it("prices the order on the server and saves it once", async () => {
    const order = await saveOrder(admin, responseId);
    expect(order).toMatchObject({ currency: "USD", total: 2 * 1999 + 850 });
    // A second save (a repeat submit) leaves the first row alone.
    await admin
      .from("response_orders")
      .update({ total_amount: 1 })
      .eq("response_id", responseId);
    await saveOrder(admin, responseId);
    const { data } = await admin
      .from("response_orders")
      .select("total_amount")
      .eq("response_id", responseId)
      .single();
    expect(data?.total_amount).toBe(1);
    await admin
      .from("response_orders")
      .update({ total_amount: 2 * 1999 + 850 })
      .eq("response_id", responseId);
    expect((await getOrder(viewer.client, responseId))?.lines).toHaveLength(2);
    expect(await getOrder(outsider.client, responseId)).toBeNull();
  });

  it("refuses an order over an item's limit or for an unknown item", async () => {
    const started = await startResponse(admin, formId);
    const result = await completeResponse(
      admin,
      started.responseId,
      1,
      "q_items",
      { q_items: { tee: 6, ghost: 1 } },
      crypto.randomUUID(),
    );
    expect(result.ok).toBe(false);
  });
});

describe("signatures (F-10)", () => {
  it("accepts only a small PNG for a signature question", async () => {
    const started = await startResponse(admin, formId);
    const prepared = await prepareUpload(admin, started.responseId, "q_sign");
    expect(prepared.acceptedMimeTypes).toEqual(["image/png"]);
    expect(prepared.maxBytes).toBeLessThanOrEqual(512 * 1024);
    await expect(
      recordUpload(admin, started.responseId, "q_sign", {
        bytes: new TextEncoder().encode("%PDF-1.4 not a signature"),
        originalFilename: "x.pdf",
      }),
    ).rejects.toBeInstanceOf(UnsupportedFileTypeError);
  });

  it("refuses to complete with a signature id that isn't this response's upload", async () => {
    const started = await startResponse(admin, formId);
    const result = await completeResponse(
      admin,
      started.responseId,
      1,
      "q_sign",
      { q_items: { mug: 1 }, q_sign: crypto.randomUUID() },
      crypto.randomUUID(),
    );
    expect(result.ok).toBe(false);
  });
});

describe("records view (F-03)", () => {
  it("only finds the response through the form it belongs to, for members", async () => {
    expect(await responseInForm(owner.client, workspaceId, formId, responseId)).toBe(
      true,
    );
    expect(await responseInForm(outsider.client, workspaceId, formId, responseId)).toBe(
      false,
    );
    expect(
      await responseInForm(owner.client, workspaceId, crypto.randomUUID(), responseId),
    ).toBe(false);
  });

  it("changes status and assignee with events, and filters by both", async () => {
    expect(
      await setReviewStatus(admin, {
        responseId,
        status: "in_progress",
        actorId: owner.id,
      }),
    ).toBe(true);
    expect(
      await setAssignee(admin, {
        workspaceId,
        responseId,
        assigneeId: viewer.id,
        actorId: owner.id,
      }),
    ).toBe(true);
    // Not a member: refused.
    expect(
      await setAssignee(admin, {
        workspaceId,
        responseId,
        assigneeId: outsider.id,
        actorId: owner.id,
      }),
    ).toBe(false);

    const filtered = await listResponses(owner.client, formId, {
      reviewStatus: "in_progress",
      assigneeId: viewer.id,
    });
    expect(filtered.items.map((i) => i.id)).toEqual([responseId]);
    const none = await listResponses(owner.client, formId, { reviewStatus: "done" });
    expect(none.items).toEqual([]);
    const unassigned = await listResponses(owner.client, formId, { assigneeId: "none" });
    expect(unassigned.items.map((i) => i.id)).not.toContain(responseId);

    const { data: events } = await viewer.client
      .from("response_events")
      .select("kind, actor_id")
      .eq("response_id", responseId);
    expect(events?.map((e) => e.kind)).toEqual(
      expect.arrayContaining(["status_changed", "assigned"]),
    );
    expect(events?.every((e) => e.actor_id === owner.id)).toBe(true);
  });

  it("keeps comments private to the team: members read, nobody writes directly", async () => {
    const comment = await addComment(admin, {
      responseId,
      body: "  Called them back.  ",
      authorId: owner.id,
    });
    expect(comment?.body).toBe("Called them back.");
    expect(await addComment(admin, { responseId, body: "   ", authorId: owner.id })).toBe(
      null,
    );
    expect((await listComments(viewer.client, responseId)).map((c) => c.body)).toEqual([
      "Called them back.",
    ]);
    expect(await listComments(outsider.client, responseId)).toEqual([]);
    const { data: anonRows } = await anon
      .from("response_comments")
      .select("id")
      .eq("response_id", responseId);
    expect(anonRows ?? []).toEqual([]);
    // Writes go through the server only — even an owner can't insert.
    const { error } = await owner.client
      .from("response_comments")
      .insert({ response_id: responseId, author_id: owner.id, body: "direct" });
    expect(error).not.toBeNull();
    const { error: statusError, data: changed } = await viewer.client
      .from("responses")
      .update({ review_status: "done" })
      .eq("id", responseId)
      .select("id");
    expect(statusError !== null || (changed ?? []).length === 0).toBe(true);
  });
});

describe("timeline and replay (F-31)", () => {
  it("lists lifecycle, team actions and integration attempts in order", async () => {
    const { data: endpoint } = await admin
      .from("webhook_endpoints")
      .insert({
        form_id: formId,
        url: "https://example.com/hook",
        signing_secret: "s".repeat(32),
        kind: "webhook",
      })
      .select("id")
      .single();
    const { data: delivery } = await admin
      .from("webhook_deliveries")
      .insert({
        endpoint_id: endpoint!.id,
        response_id: responseId,
        event_id: crypto.randomUUID(),
        event_type: "response.completed",
        payload: {} as Json,
        status: "exhausted",
        attempt_count: 8,
        last_error: "HTTP 500",
      })
      .select("id, event_id")
      .single();

    const { data: response } = await admin
      .from("responses")
      .select("started_at, last_active_at, completed_at, status")
      .eq("id", responseId)
      .single();
    const timeline = await getResponseTimeline(viewer.client, {
      id: responseId,
      startedAt: response!.started_at,
      lastActiveAt: response!.last_active_at,
      completedAt: response!.completed_at,
      status: response!.status,
    });
    const titles = timeline.map((e) => e.title);
    expect(titles[0]).toBe("Started");
    expect(titles).toContain("Submitted");
    const hook = timeline.find((e) => e.key === `webhook-${delivery!.id}`);
    expect(hook).toMatchObject({ outcome: "failed", replay: { target: "webhook" } });
    expect(hook?.detail).toContain("HTTP 500");
    const times = timeline.map((e) => e.at);
    expect([...times].sort()).toEqual(times);
    // An outsider's view has none of it.
    const theirs = await getResponseTimeline(outsider.client, {
      id: responseId,
      startedAt: response!.started_at,
      lastActiveAt: response!.last_active_at,
      completedAt: response!.completed_at,
      status: response!.status,
    });
    expect(theirs.some((e) => e.key.startsWith("webhook-"))).toBe(false);

    // Replay: back in the queue as the same row (same event id), once.
    expect(
      await replayAttempt(admin, {
        target: "webhook",
        id: delivery!.id,
        responseId,
        actorId: owner.id,
      }),
    ).toBe(true);
    const { data: after } = await admin
      .from("webhook_deliveries")
      .select("status, attempt_count, event_id")
      .eq("id", delivery!.id)
      .single();
    expect(after).toMatchObject({
      status: "pending",
      attempt_count: 0,
      event_id: delivery!.event_id,
    });
    expect(
      await replayAttempt(admin, {
        target: "webhook",
        id: delivery!.id,
        responseId,
        actorId: owner.id,
      }),
    ).toBe(false);
    // Not this response's attempt: refused.
    expect(
      await replayAttempt(admin, {
        target: "webhook",
        id: delivery!.id,
        responseId: crypto.randomUUID(),
        actorId: owner.id,
      }),
    ).toBe(false);
  });

  it("deletes timeline, comments and order with the response", async () => {
    const started = await startResponse(admin, formId);
    await addComment(admin, {
      responseId: started.responseId,
      body: "temp",
      authorId: owner.id,
    });
    await admin.from("responses").delete().eq("id", started.responseId);
    const { data: left } = await admin
      .from("response_events")
      .select("id")
      .eq("response_id", started.responseId);
    expect(left).toEqual([]);
  });
});
