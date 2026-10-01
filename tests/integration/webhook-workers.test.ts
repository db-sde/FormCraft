import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { completeResponse, startResponse } from "@/domains/responses";
import {
  dispatchDueDeliveries,
  enqueueWebhookDeliveries,
  recoverMissingWebhookDeliveries,
} from "@/domains/webhooks";

/**
 * The webhook delivery pipeline against the real database and a fake
 * receiver. Nothing sleeps for timing: contention is created with
 * simultaneous sweeps, lease expiry by rewinding next_attempt_at, and
 * each scenario asserts what the *receiver* saw as well as what was
 * recorded.
 *
 * Only this file sweeps webhook_deliveries (the Sheets equivalent lives
 * in sheets.test.ts), so parallel test files can't claim each other's
 * jobs.
 */
const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().slice(0, 8);

const schema = {
  schemaVersion: 1,
  meta: { title: "Webhook workers" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "q_name",
      type: "short_text",
      order: 0,
      label: "Name",
      required: true,
      settings: {},
    },
  ],
  logic: [],
} as unknown as Json;

// ---- fake receiver -------------------------------------------------------
type Received = { path: string; eventId: string | null; body: string };
const received: Received[] = [];
let server: Server;
let base: string;

function receiver(): Promise<void> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        let eventId: string | null = null;
        try {
          eventId = JSON.parse(body).eventId ?? null;
        } catch {
          // not JSON
        }
        received.push({ path: req.url ?? "", eventId, body });
        const respond = (status: number) => {
          res.writeHead(status);
          res.end();
        };
        if (req.url === "/slow") setTimeout(() => respond(200), 150);
        else if (req.url === "/500") respond(500);
        else if (req.url === "/429") respond(429);
        else respond(200);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object")
        base = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
}

// ---- fixtures ---------------------------------------------------------------
let userId: string;
let workspaceId: string;
let formId: string;

async function newEndpoint(path: string, enabled = true) {
  const { data, error } = await admin
    .from("webhook_endpoints")
    .insert({
      form_id: formId,
      url: `${base}${path}`,
      signing_secret: "whsec_test",
      enabled,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function completedResponse(
  answers: Record<string, unknown> = { q_name: "Ada" },
  spamSuspected = false,
) {
  const { responseId } = await startResponse(admin, formId);
  const result = await completeResponse(
    admin,
    responseId,
    1,
    "q_name",
    answers,
    crypto.randomUUID(),
    { spamSuspected },
  );
  expect(result.ok).toBe(true);
  return responseId;
}

async function deliveriesFor(endpointId: string) {
  const { data } = await admin
    .from("webhook_deliveries")
    .select("id, event_id, status, attempt_count, last_error, next_attempt_at, payload")
    .eq("endpoint_id", endpointId)
    .order("created_at");
  return data ?? [];
}

/** Disable every endpoint a previous test left behind so its leftovers
 * can't be swept into this test's assertions. */
async function retireEarlierWork() {
  await admin.from("webhook_endpoints").update({ enabled: false }).eq("form_id", formId);
  await admin
    .from("webhook_deliveries")
    .update({ status: "exhausted" })
    .in("status", ["pending", "failed"])
    .in(
      "endpoint_id",
      (
        (await admin.from("webhook_endpoints").select("id").eq("form_id", formId)).data ??
        []
      ).map((e) => e.id),
    );
}

beforeAll(async () => {
  await receiver();
  const { data: user, error } = await admin.auth.admin.createUser({
    email: `webhook-workers-${runId}@example.com`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (error) throw error;
  userId = user.user.id;
  const { data: workspace } = await admin
    .from("workspaces")
    .insert({ name: "Webhook workers", slug: `ww-${runId}`, owner_id: userId })
    .select("id")
    .single();
  workspaceId = workspace!.id;
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Webhook workers",
      slug: `ww-form-${runId}`,
      created_by: userId,
    })
    .select("id")
    .single();
  formId = form!.id;
  await admin
    .from("form_versions")
    .insert({ form_id: formId, status: "draft", version_number: 1, schema });
  await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: schema,
  });
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await admin.from("workspaces").delete().eq("id", workspaceId);
  await admin.auth.admin.deleteUser(userId);
});

describe("enqueueing", () => {
  it("builds the payload from what is stored, at the completion time", async () => {
    await retireEarlierWork();
    const endpointId = await newEndpoint("/ok");
    const responseId = await completedResponse({
      q_name: "Grace",
      not_a_question: "ignored",
    });

    expect(await enqueueWebhookDeliveries(admin, responseId)).toBe(1);
    const [delivery] = await deliveriesFor(endpointId);
    const payload = delivery.payload as {
      answers: Record<string, unknown>;
      submittedAt: string;
      responseId: string;
      formId: string;
    };
    expect(payload.answers).toEqual({ q_name: "Grace" });
    expect(payload.responseId).toBe(responseId);
    expect(payload.formId).toBe(formId);
    const { data: row } = await admin
      .from("responses")
      .select("completed_at")
      .eq("id", responseId)
      .single();
    expect(new Date(payload.submittedAt).getTime()).toBe(
      new Date(row!.completed_at!).getTime(),
    );
  });

  it("is idempotent: enqueueing twice makes one delivery", async () => {
    await retireEarlierWork();
    const endpointId = await newEndpoint("/ok");
    const responseId = await completedResponse();
    await Promise.all([
      enqueueWebhookDeliveries(admin, responseId),
      enqueueWebhookDeliveries(admin, responseId),
      enqueueWebhookDeliveries(admin, responseId),
    ]);
    expect(await deliveriesFor(endpointId)).toHaveLength(1);
  });

  it("sends nothing for spam-flagged or unfinished responses", async () => {
    await retireEarlierWork();
    const endpointId = await newEndpoint("/ok");
    const spam = await completedResponse({ q_name: "Bot" }, true);
    const unfinished = (await startResponse(admin, formId)).responseId;
    expect(await enqueueWebhookDeliveries(admin, spam)).toBe(0);
    expect(await enqueueWebhookDeliveries(admin, unfinished)).toBe(0);
    expect(await deliveriesFor(endpointId)).toHaveLength(0);
  });
});

describe("recovering a lost enqueue", () => {
  it("creates the delivery a failed post-submit callback missed — exactly once", async () => {
    await retireEarlierWork();
    const endpointId = await newEndpoint("/ok");
    const responseId = await completedResponse(); // nothing enqueues it

    expect((await recoverMissingWebhookDeliveries(admin)).recovered).toBe(1);
    expect(await deliveriesFor(endpointId)).toHaveLength(1);
    expect((await recoverMissingWebhookDeliveries(admin)).recovered).toBe(0);
    expect(responseId).toBeTruthy();
  });

  it("doesn't backfill history older than a day", async () => {
    await retireEarlierWork();
    const endpointId = await newEndpoint("/ok");
    const responseId = await completedResponse();
    await admin
      .from("responses")
      .update({ completed_at: new Date(Date.now() - 3 * 86_400_000).toISOString() })
      .eq("id", responseId);
    await recoverMissingWebhookDeliveries(admin);
    expect(await deliveriesFor(endpointId)).toHaveLength(0);
  });
});

describe("dispatching", () => {
  it("overlapping sweeps deliver each event exactly once", async () => {
    await retireEarlierWork();
    const endpointId = await newEndpoint("/slow");
    for (let i = 0; i < 6; i += 1) {
      await enqueueWebhookDeliveries(admin, await completedResponse({ q_name: `n${i}` }));
    }
    const eventIds = (await deliveriesFor(endpointId)).map((d) => d.event_id);
    expect(eventIds).toHaveLength(6);
    received.length = 0;

    // Three workers at once, each willing to take the whole backlog.
    await Promise.all([
      dispatchDueDeliveries(admin),
      dispatchDueDeliveries(admin),
      dispatchDueDeliveries(admin),
    ]);

    for (const eventId of eventIds) {
      expect(
        received.filter((r) => r.eventId === eventId),
        eventId,
      ).toHaveLength(1);
    }
    expect((await deliveriesFor(endpointId)).map((d) => d.status)).toEqual(
      Array(6).fill("succeeded"),
    );
  });

  it("holds a claimed job for its worker, and frees it when the lease runs out", async () => {
    await retireEarlierWork();
    const endpointId = await newEndpoint("/ok");
    await enqueueWebhookDeliveries(admin, await completedResponse());
    const [delivery] = await deliveriesFor(endpointId);

    const first = await admin.rpc("claim_due_webhook_deliveries", {
      p_limit: 50,
      p_lease_seconds: 120,
    });
    expect(first.data?.some((d) => d.id === delivery.id)).toBe(true);
    // Reserved: a second worker gets nothing for it.
    const second = await admin.rpc("claim_due_webhook_deliveries", {
      p_limit: 50,
      p_lease_seconds: 120,
    });
    expect(second.data?.some((d) => d.id === delivery.id)).toBe(false);

    // The first worker "crashed"; its lease expires.
    await admin
      .from("webhook_deliveries")
      .update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", delivery.id);
    const third = await admin.rpc("claim_due_webhook_deliveries", {
      p_limit: 50,
      p_lease_seconds: 120,
    });
    expect(third.data?.some((d) => d.id === delivery.id)).toBe(true);
  });

  it("a disabled endpoint's backlog can't starve working ones", async () => {
    await retireEarlierWork();
    const disabled = await newEndpoint("/ok", false);
    const working = await newEndpoint("/ok");
    // 25 old jobs for the disabled endpoint (more than one sweep takes).
    const stale = Array.from({ length: 25 }, () => ({
      endpoint_id: disabled,
      event_type: "response.completed",
      payload: { eventId: "x" } as Json,
      status: "pending" as const,
      next_attempt_at: new Date(Date.now() - 3600_000).toISOString(),
    }));
    await admin.from("webhook_deliveries").insert(stale);
    await enqueueWebhookDeliveries(
      admin,
      await completedResponse({ q_name: "Behind them" }),
    );
    // Re-enable only for the working one: enqueue targeted it already.
    expect((await deliveriesFor(working)).length).toBe(1);

    for (let sweep = 0; sweep < 3; sweep += 1) await dispatchDueDeliveries(admin);

    expect((await deliveriesFor(working))[0].status).toBe("succeeded");
    const retired = await deliveriesFor(disabled);
    expect(retired).toHaveLength(25);
    expect(new Set(retired.map((d) => d.status))).toEqual(new Set(["exhausted"]));
    expect(retired[0].last_error).toMatch(/disabled/);
  });

  it.each([
    ["a server error", "/500"],
    ["rate limiting", "/429"],
  ])("%s is retried later with backoff, not dropped or hammered", async (_name, path) => {
    await retireEarlierWork();
    const endpointId = await newEndpoint(path);
    await enqueueWebhookDeliveries(admin, await completedResponse());
    await dispatchDueDeliveries(admin);

    const [delivery] = await deliveriesFor(endpointId);
    expect(delivery.status).toBe("failed");
    expect(delivery.attempt_count).toBe(1);
    expect(delivery.last_error).toMatch(/HTTP (500|429)/);
    expect(new Date(delivery.next_attempt_at).getTime()).toBeGreaterThan(Date.now());

    // Not due yet, so another sweep leaves it alone.
    received.length = 0;
    await dispatchDueDeliveries(admin);
    expect(received.filter((r) => r.path === path)).toHaveLength(0);
  });

  it("gives up for good after the last allowed attempt", async () => {
    await retireEarlierWork();
    const endpointId = await newEndpoint("/500");
    await enqueueWebhookDeliveries(admin, await completedResponse());
    const [delivery] = await deliveriesFor(endpointId);
    await admin
      .from("webhook_deliveries")
      .update({ attempt_count: 5, status: "failed" })
      .eq("id", delivery.id);

    await dispatchDueDeliveries(admin);
    const [after] = await deliveriesFor(endpointId);
    expect(after.status).toBe("exhausted");
    expect(after.attempt_count).toBe(6);
  });

  it("an unreachable destination is recorded without affecting other deliveries", async () => {
    await retireEarlierWork();
    const dead = await newEndpoint("/ok");
    await admin
      .from("webhook_endpoints")
      .update({ url: "http://127.0.0.1:1/unreachable" })
      .eq("id", dead);
    const alive = await newEndpoint("/ok");
    await enqueueWebhookDeliveries(admin, await completedResponse());

    await dispatchDueDeliveries(admin);
    expect((await deliveriesFor(dead))[0].status).toBe("failed");
    expect((await deliveriesFor(alive))[0].status).toBe("succeeded");
  });
});
