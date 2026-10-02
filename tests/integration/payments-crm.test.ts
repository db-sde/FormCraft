import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { completeResponse, startResponse } from "@/domains/responses";
import { loadCredential, saveCredential } from "@/domains/integrations/credentials";
import { sendToHubspot } from "@/domains/integrations/hubspot";
import {
  applyStripeEvent,
  checkoutForResponse,
  refreshFromStripe,
} from "@/domains/payments";
import { parseFormSchema } from "@/domains/forms/schema";

/** Stripe payments and HubSpot sync against the real database, with
 * fake provider APIs: encrypted credentials, a server-computed amount,
 * status only from Stripe, and create-or-update contacts. */
const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().slice(0, 8);
const schemaJson = {
  schemaVersion: 1,
  meta: { title: "Order" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  variables: [{ id: "v_total", name: "total", type: "number" }],
  questions: [
    {
      id: "qty",
      type: "number",
      order: 0,
      label: "How many?",
      required: true,
      settings: {},
    },
    {
      id: "email",
      type: "email",
      order: 1,
      label: "Email",
      required: true,
      settings: {},
    },
  ],
  logic: [],
  rules: [
    {
      id: "r_total",
      on: { event: "question_answered", questionId: "qty" },
      then: [
        {
          type: "set_variable",
          variableId: "v_total",
          op: "set",
          value: {
            type: "binary",
            op: "*",
            left: { type: "answer", questionId: "qty" },
            right: { type: "literal", value: 12.5 },
          },
        },
      ],
    },
  ],
} as unknown as Json;

let userId: string;
let workspaceId: string;
let formId: string;

beforeAll(async () => {
  const { data: user } = await admin.auth.admin.createUser({
    email: `pay-${runId}@example.com`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  userId = user!.user!.id;
  const { data: ws } = await admin
    .from("workspaces")
    .insert({ name: "Pay", slug: `pay-${runId}`, owner_id: userId })
    .select("id")
    .single();
  workspaceId = ws!.id;
  await admin.from("workspaces").update({ plan_id: "business" }).eq("id", workspaceId);
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Order",
      slug: `pay-${runId}`,
      created_by: userId,
      payment_config: {
        amount: null,
        amountVariableId: "v_total",
        currency: "usd",
        description: "Tickets",
      },
    })
    .select("id")
    .single();
  formId = form!.id;
  await admin
    .from("form_versions")
    .insert({ form_id: formId, status: "draft", version_number: 1, schema: schemaJson });
  const { error } = await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: schemaJson,
  });
  if (error) throw error;
  await saveCredential(
    admin,
    workspaceId,
    "stripe",
    { secretKey: "sk_test_fake123456", webhookSecret: "whsec_fake123456" },
    "sk_test_…3456",
  );
});

afterAll(async () => {
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("credentials", () => {
  it("are stored encrypted and read back on the server", async () => {
    const { data } = await admin
      .from("integration_credentials")
      .select("encrypted")
      .eq("workspace_id", workspaceId)
      .eq("provider", "stripe")
      .single();
    expect(JSON.stringify(data)).not.toContain("sk_test_fake123456");
    expect(await loadCredential(admin, workspaceId, "stripe")).toEqual({
      secretKey: "sk_test_fake123456",
      webhookSecret: "whsec_fake123456",
    });
  });
});

describe("payments", () => {
  it("charge the amount the server works out, and only Stripe marks it paid", async () => {
    const { responseId } = await startResponse(admin, formId);
    await completeResponse(
      admin,
      responseId,
      1,
      "email",
      { qty: 3, email: "a@b.co" },
      crypto.randomUUID(),
    );

    const calls: { url: string; body: string }[] = [];
    const fakeStripe = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      if (String(url).endsWith("/v1/checkout/sessions")) {
        return Response.json({
          id: "cs_test_abc123",
          url: "https://checkout.stripe.com/c/pay/cs_test_abc123",
          livemode: false,
        });
      }
      return Response.json({
        id: "cs_test_abc123",
        payment_status: "unpaid",
        status: "open",
      });
    }) as typeof fetch;

    const started = await checkoutForResponse(
      admin,
      responseId,
      { origin: "https://forms.example" },
      fakeStripe,
    );
    expect(started).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_abc123" });
    const body = new URLSearchParams(calls[0].body);
    // 3 × 12.5 = 37.50 → 3750 cents, from the server's own walk.
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("3750");
    expect(body.get("metadata[response_id]")).toBe(responseId);
    expect(body.get("success_url")).toBe(
      `https://forms.example/f/pay-${runId}/payment?session_id={CHECKOUT_SESSION_ID}`,
    );

    // Coming back without Stripe saying "paid" changes nothing.
    expect(
      await refreshFromStripe(admin, workspaceId, "cs_test_abc123", fakeStripe),
    ).toBe("pending");

    // A webhook for some other session is ignored.
    expect(
      await applyStripeEvent(admin, {
        type: "checkout.session.completed",
        data: { object: { id: "cs_test_other", payment_status: "paid" } },
      }),
    ).toBe("ignored");

    expect(
      await applyStripeEvent(admin, {
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_abc123",
            payment_status: "paid",
            metadata: { response_id: responseId },
          },
        },
      }),
    ).toBe("updated");
    const { data } = await admin
      .from("payments")
      .select("status, amount, paid_at")
      .eq("response_id", responseId)
      .single();
    expect(data).toMatchObject({ status: "paid", amount: 3750 });
    expect(data?.paid_at).not.toBeNull();

    // Paid never goes back, and a paid response isn't charged again.
    await applyStripeEvent(admin, {
      type: "checkout.session.expired",
      data: { object: { id: "cs_test_abc123" } },
    });
    expect(
      (
        await admin
          .from("payments")
          .select("status")
          .eq("response_id", responseId)
          .single()
      ).data?.status,
    ).toBe("paid");
    expect(
      await checkoutForResponse(
        admin,
        responseId,
        { origin: "https://forms.example" },
        fakeStripe,
      ),
    ).toBeNull();
  });
});

describe("HubSpot", () => {
  it("updates the contact by email, or creates it when there isn't one", async () => {
    await saveCredential(
      admin,
      workspaceId,
      "hubspot",
      { token: "pat-na1-xxxxxxxxxxxxxxxxxxxxxxxx" },
      "pat-na1-…xxxx",
    );
    const calls: { method: string; url: string; body: string; auth: string | null }[] =
      [];
    const fakeHubspot = (async (url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        method,
        url: String(url),
        body: String(init?.body ?? ""),
        auth: new Headers(init?.headers).get("authorization"),
      });
      return new Response("{}", { status: method === "PATCH" ? 404 : 201 });
    }) as typeof fetch;
    const schema = parseFormSchema(schemaJson);
    const result = await sendToHubspot(
      admin,
      {
        workspaceId,
        schema,
        answers: { qty: 2, email: "lead@example.com" },
        mapping: { email: "email", quantity: "qty" },
      },
      fakeHubspot,
    );
    expect(result).toEqual({ status: "succeeded" });
    expect(calls.map((c) => c.method)).toEqual(["PATCH", "POST"]);
    expect(calls[0].url).toContain(
      "/crm/v3/objects/contacts/lead%40example.com?idProperty=email",
    );
    expect(JSON.parse(calls[1].body)).toEqual({
      properties: { email: "lead@example.com", quantity: "2" },
    });
    expect(calls[0].auth).toBe("Bearer pat-na1-xxxxxxxxxxxxxxxxxxxxxxxx");

    // A rejected token marks the connection for reconnecting.
    const rejected = await sendToHubspot(
      admin,
      {
        workspaceId,
        schema,
        answers: { email: "lead@example.com" },
        mapping: { email: "email" },
      },
      (async () => new Response("", { status: 401 })) as typeof fetch,
    );
    expect(rejected.status).toBe("failed");
    const { data } = await admin
      .from("integration_credentials")
      .select("status")
      .eq("workspace_id", workspaceId)
      .eq("provider", "hubspot")
      .single();
    expect(data?.status).toBe("invalid");
  });
});
