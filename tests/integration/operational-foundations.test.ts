import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { saveCredential } from "@/domains/integrations/credentials";
import { beginAi } from "@/domains/ai/gateway";
import { reconcilePendingPayments } from "@/domains/payments/reconcile";
import { audit } from "@/domains/audit/log";

vi.mock("server-only", () => ({}));

/**
 * The five foundations (migration 65) against the real database: AI
 * credits that can't be overspent by requests at once, payments still
 * pending asked about directly (and only once an hour), and audit
 * entries with a reason and outcome.
 */
const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
const schema = {
  schemaVersion: 1,
  meta: { title: "Paid" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "q1",
      type: "short_text",
      order: 0,
      label: "Name",
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

beforeAll(async () => {
  const { data: user } = await admin.auth.admin.createUser({
    email: `found-${runId}@example.com`,
    password: `Pw-${crypto.randomUUID()}`,
    email_confirm: true,
  });
  userId = user.user!.id;
  const { data: ws } = await admin
    .from("workspaces")
    .insert({ name: "Foundations", slug: `found-${runId}`, owner_id: userId })
    .select("id")
    .single();
  workspaceId = ws!.id;
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Paid",
      slug: `found-${runId}`,
      created_by: userId,
    })
    .select("id")
    .single();
  formId = form!.id;
  await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: schema,
  });
  versionId = (
    await admin
      .from("form_versions")
      .select("id")
      .eq("form_id", formId)
      .eq("status", "published")
      .single()
  ).data!.id;
  await saveCredential(
    admin,
    workspaceId,
    "stripe",
    { secretKey: "sk_test_foundations", webhookSecret: "whsec_foundations" },
    "test",
  );
  await saveCredential(
    admin,
    workspaceId,
    "razorpay",
    { keyId: "rzp_test_abcdefgh1234", keySecret: "secret", webhookSecret: "hook" },
    "test",
  );
}, 60_000);

afterAll(async () => {
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

async function pendingAttempt(
  provider: "stripe" | "razorpay",
  ref: string,
  minutesAgo: number,
) {
  const { data: r } = await admin
    .from("responses")
    .insert({
      form_id: formId,
      form_version_id: versionId,
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  const { data: a, error } = await admin
    .from("payment_attempts")
    .insert({
      response_id: r!.id,
      form_id: formId,
      provider,
      provider_ref: ref,
      subtotal: 2500,
      amount: 2500,
      currency: provider === "stripe" ? "usd" : "inr",
      created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return { responseId: r!.id, attemptId: a!.id };
}

describe("AI credits (foundations §3)", () => {
  it("can't be overspent by requests at the same moment", async () => {
    // Form tools run on Sonnet: 5 credits a call, so 15 cover three.
    const entitlements = { ai_form_tools: true, ai_credits_per_month: 15 } as Parameters<
      typeof beginAi
    >[1]["entitlements"];
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        beginAi(admin, { feature: "form_edit", workspaceId, entitlements }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    const { data } = await admin
      .from("usage_counters")
      .select("value")
      .eq("workspace_id", workspaceId)
      .eq("metric", "ai_credits")
      .single();
    expect(Number(data!.value)).toBe(15);
  });
});

describe("payment reconciliation (foundations §5)", () => {
  const stripeRef = `cs_test_F${runId}`;
  const orderRef = `order_F${runId}`;
  const calls: string[] = [];
  const provider = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith(`/v1/checkout/sessions/${stripeRef}`)) {
      return new Response(
        JSON.stringify({
          id: stripeRef,
          status: "complete",
          payment_status: "paid",
          payment_intent: `pi_F${runId}`,
          metadata: {},
        }),
        { status: 200 },
      );
    }
    if (url.endsWith(`/v1/orders/${orderRef}/payments`)) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: `pay_F${runId}`,
              order_id: orderRef,
              amount: 2500,
              currency: "INR",
              status: "captured",
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  it("marks paid what the provider says is paid, once, and leaves young attempts alone", async () => {
    const stripe = await pendingAttempt("stripe", stripeRef, 20);
    const razorpay = await pendingAttempt("razorpay", orderRef, 30);
    const young = await pendingAttempt("stripe", `cs_test_Y${runId}`, 2);

    await reconcilePendingPayments(admin, provider);

    const status = async (id: string) =>
      (
        await admin
          .from("payment_attempts")
          .select("status, checked_at")
          .eq("id", id)
          .single()
      ).data!;
    expect(await status(stripe.attemptId)).toMatchObject({ status: "paid" });
    expect(await status(razorpay.attemptId)).toMatchObject({ status: "paid" });
    expect(await status(young.attemptId)).toMatchObject({
      status: "pending",
      checked_at: null,
    });
    const { data: payments } = await admin
      .from("payments")
      .select("response_id, status")
      .in("response_id", [stripe.responseId, razorpay.responseId]);
    expect(payments!.map((p) => p.status)).toEqual(["paid", "paid"]);

    // Asked again within the hour: neither is asked twice.
    const before = calls.length;
    await reconcilePendingPayments(admin, provider);
    expect(calls.slice(before).filter((u) => u.includes(runId))).toEqual([]);
  });

  it("asks a still-pending payment again only after an hour", async () => {
    const ref = `cs_test_P${runId}`;
    const pending = await pendingAttempt("stripe", ref, 40);
    await reconcilePendingPayments(admin, provider);
    const first = calls.filter((u) => u.includes(ref)).length;
    expect(first).toBe(1);
    await reconcilePendingPayments(admin, provider);
    expect(calls.filter((u) => u.includes(ref)).length).toBe(1);
    await admin
      .from("payment_attempts")
      .update({ checked_at: new Date(Date.now() - 61 * 60_000).toISOString() })
      .eq("id", pending.attemptId);
    await reconcilePendingPayments(admin, provider);
    expect(calls.filter((u) => u.includes(ref)).length).toBe(2);
  });
});

describe("audit entries (foundations §4)", () => {
  it("keep a reason and an outcome; no request outside a request", async () => {
    await audit(admin, {
      workspaceId,
      actorId: userId,
      action: "response.deleted",
      target: { type: "response", id: "r1" },
      reason: "Duplicate entry",
      outcome: "denied",
    });
    const { data } = await admin
      .from("audit_logs")
      .select("action, reason, outcome, request_id")
      .eq("workspace_id", workspaceId)
      .eq("action", "response.deleted")
      .single();
    expect(data).toEqual({
      action: "response.deleted",
      reason: "Duplicate entry",
      outcome: "denied",
      request_id: null,
    });
  });
});
