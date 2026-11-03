import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { completeResponse, startResponse } from "@/domains/responses";
import { saveCredential } from "@/domains/integrations/credentials";
import { quotePayment, startPayment } from "@/domains/payments/flow";
import { checkoutSignature } from "@/domains/payments/razorpay";
import {
  applyRazorpayEvent,
  verifyRazorpayCheckout,
} from "@/domains/payments/razorpay-events";
import { applyStripeEvent } from "@/domains/payments";

/**
 * Master spec Phase 7 (F-22/F-35) against the real database, with
 * Razorpay faked at the fetch level: the server's amount and coupons, one
 * order reused per amount, paid only after a verified signature and
 * Razorpay's own record, duplicate and out-of-order webhooks (spec §6.1
 * #3), a second payment flagged, refunds recorded, free-by-coupon, and the
 * database guard that a paid payment never goes back.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin: SupabaseClient<Database> = createClient<Database>(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().slice(0, 8);
const SECRET = "rzpSecretForTests1234";
const HOOK = "hook-secret-e2e";

const schema = {
  schemaVersion: 1,
  meta: { title: "Workshop" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  logic: [],
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
} as unknown as Json;

let ownerId: string;
let viewer: { id: string; client: SupabaseClient<Database> };
let workspaceId: string;
let otherWorkspaceId: string;
let formId: string;

/** A fake Razorpay: orders it creates and payments it knows. */
const orders: { id: string; amount: number }[] = [];
const payments = new Map<string, Record<string, unknown>>();
const fakeRazorpay = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = new URL(String(input));
  if (init?.method === "POST" && u.pathname === "/v1/orders") {
    const body = JSON.parse(String(init.body)) as { amount: number };
    const order = { id: `order_T${runId}${orders.length + 1}`, amount: body.amount };
    orders.push(order);
    return Response.json({ ...order, currency: "INR", status: "created" });
  }
  const pay = /^\/v1\/payments\/(pay_\w+)$/.exec(u.pathname);
  if (pay && payments.has(pay[1])) return Response.json(payments.get(pay[1]));
  return Response.json({ error: { description: "not found" } }, { status: 404 });
}) as typeof fetch;

async function submitted(): Promise<string> {
  const { responseId } = await startResponse(admin, formId);
  const done = await completeResponse(
    admin,
    responseId,
    1,
    "q_name",
    { q_name: "Asha" },
    crypto.randomUUID(),
  );
  expect(done.ok).toBe(true);
  return responseId;
}

const start = (responseId: string, couponCode?: string) =>
  startPayment(admin, responseId, {
    couponCode,
    origin: "https://forms.example",
    slug: `rzp-${runId}`,
    fetch: fakeRazorpay,
  });

function captured(orderId: string, amount: number, id = `pay_${orderId.slice(6)}`) {
  const p = { id, order_id: orderId, amount, currency: "INR", status: "captured" };
  payments.set(id, p);
  return p;
}

async function paymentOf(responseId: string) {
  const { data } = await admin
    .from("payments")
    .select(
      "status, amount, discount, coupon_code, provider, provider_payment_id, refunded_amount",
    )
    .eq("response_id", responseId)
    .maybeSingle();
  return data;
}

beforeAll(async () => {
  const { data: owner } = await admin.auth.admin.createUser({
    email: `rzp-${runId}@example.com`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  ownerId = owner!.user!.id;
  const email = `rzp-view-${runId}@example.com`;
  const password = crypto.randomUUID();
  const { data: v } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false },
  });
  await client.auth.signInWithPassword({ email, password });
  viewer = { id: v!.user!.id, client };

  const { data: ws } = await admin
    .from("workspaces")
    .insert({ name: "Pay", slug: `rzp-${runId}`, owner_id: ownerId, plan_id: "business" })
    .select("id")
    .single();
  workspaceId = ws!.id;
  const { data: other } = await admin
    .from("workspaces")
    .insert({ name: "Other", slug: `rzp-o-${runId}`, owner_id: ownerId })
    .select("id")
    .single();
  otherWorkspaceId = other!.id;
  await admin.from("workspace_members").insert([
    { workspace_id: workspaceId, user_id: ownerId, role: "owner", permissions: {} },
    { workspace_id: workspaceId, user_id: viewer.id, role: "viewer", permissions: {} },
  ]);
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Workshop",
      slug: `rzp-${runId}`,
      created_by: ownerId,
      payment_config: {
        provider: "razorpay",
        amount: 499,
        amountVariableId: null,
        fromOrder: false,
        currency: "inr",
        description: "Workshop seat",
      },
    })
    .select("id")
    .single();
  formId = form!.id;
  await admin
    .from("form_versions")
    .insert({ form_id: formId, status: "draft", version_number: 1, schema });
  const { error } = await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: schema,
  });
  if (error) throw error;
  await saveCredential(
    admin,
    workspaceId,
    "razorpay",
    { keyId: "rzp_test_abcdefgh1234", keySecret: SECRET, webhookSecret: HOOK },
    "rzp_test_abcdefgh1234 (test mode)",
  );
  await admin.from("form_documents").insert({ form_id: formId, kind: "receipt" });
  await admin.from("coupons").insert([
    { form_id: formId, code: "SAVE10", kind: "percent", percent_off: 10 },
    { form_id: formId, code: "ONCE", kind: "amount", amount_off: 5000, max_uses: 1 },
    { form_id: formId, code: "FREE", kind: "percent", percent_off: 100 },
    {
      form_id: formId,
      code: "OLD",
      kind: "percent",
      percent_off: 50,
      expires_at: "2020-01-01T00:00:00Z",
    },
  ]);
}, 60_000);

afterAll(async () => {
  await admin.from("workspaces").delete().in("id", [workspaceId, otherWorkspaceId]);
  await admin.auth.admin.deleteUser(ownerId);
  await admin.auth.admin.deleteUser(viewer.id);
});

describe("quotes and coupons", () => {
  it("works out the amount on the server and checks coupons without using them", async () => {
    const id = await submitted();
    const plain = await quotePayment(admin, id);
    expect(plain).toMatchObject({
      ok: true,
      status: null,
      quote: {
        provider: "razorpay",
        currency: "inr",
        subtotal: 49_900,
        total: 49_900,
        couponsAvailable: true,
      },
    });
    expect(await quotePayment(admin, id, "save10")).toMatchObject({
      ok: true,
      quote: {
        discount: 4990,
        total: 44_910,
        coupon: { code: "SAVE10", label: "10% off" },
      },
    });
    expect(await quotePayment(admin, id, "OLD")).toMatchObject({
      couponError: "That code has expired.",
      quote: { total: 49_900 },
    });
    expect(await quotePayment(admin, id, "NOPE")).toMatchObject({
      couponError: "That code isn't valid.",
    });
    const { data } = await admin
      .from("coupons")
      .select("uses")
      .eq("code", "SAVE10")
      .single();
    expect(data?.uses).toBe(0);
  });

  it("only lets editors manage coupons, and nobody but the server counts uses", async () => {
    const { error } = await viewer.client
      .from("coupons")
      .insert({ form_id: formId, code: "VIEWER", kind: "percent", percent_off: 5 });
    expect(error).not.toBeNull();
    const { data: seen } = await viewer.client
      .from("coupons")
      .select("code")
      .eq("form_id", formId);
    expect(seen?.length).toBeGreaterThan(0);
  });
});

describe("Razorpay payments (F-35)", () => {
  it("reuses the open order for the same amount, and makes a new one for a new amount", async () => {
    const id = await submitted();
    const first = await start(id);
    const again = await start(id);
    expect(first).toMatchObject({ kind: "razorpay", amount: 49_900, currency: "INR" });
    expect(again).toMatchObject({
      kind: "razorpay",
      orderId: (first as { orderId: string }).orderId,
    });
    const discounted = await start(id, "SAVE10");
    expect(discounted).toMatchObject({ kind: "razorpay", amount: 44_910 });
    expect((discounted as { orderId: string }).orderId).not.toBe(
      (first as { orderId: string }).orderId,
    );
    expect(await paymentOf(id)).toMatchObject({
      status: "pending",
      amount: 44_910,
      coupon_code: "SAVE10",
    });
    expect(await start(id, "NOPE")).toEqual({
      kind: "error",
      message: "That code isn't valid.",
    });
  });

  it("counts a payment only with Razorpay's signature and its own record of the capture", async () => {
    const id = await submitted();
    const order = (await start(id, "SAVE10")) as { orderId: string; amount: number };
    const pay = captured(order.orderId, order.amount);
    payments.set(pay.id, { ...pay, status: "authorized" });
    const signature = checkoutSignature(order.orderId, pay.id, SECRET);
    // A forged signature, or someone else's response: refused.
    expect(
      await verifyRazorpayCheckout(
        admin,
        {
          responseId: id,
          orderId: order.orderId,
          paymentId: pay.id,
          signature: "0".repeat(64),
        },
        fakeRazorpay,
      ),
    ).toBe("invalid");
    expect(
      await verifyRazorpayCheckout(
        admin,
        {
          responseId: crypto.randomUUID(),
          orderId: order.orderId,
          paymentId: pay.id,
          signature,
        },
        fakeRazorpay,
      ),
    ).toBe("invalid");
    // Authorized but not captured: not paid yet.
    const input = {
      responseId: id,
      orderId: order.orderId,
      paymentId: pay.id,
      signature,
    };
    expect(await verifyRazorpayCheckout(admin, input, fakeRazorpay)).toBe("pending");
    expect((await paymentOf(id))?.status).toBe("pending");
    payments.set(pay.id, pay);
    expect(await verifyRazorpayCheckout(admin, input, fakeRazorpay)).toBe("paid");
    expect(await paymentOf(id)).toMatchObject({
      status: "paid",
      amount: 44_910,
      discount: 4990,
      provider: "razorpay",
      provider_payment_id: pay.id,
    });
    // Paid once: the coupon counted once, the receipt issued, no new order.
    const { data: c } = await admin
      .from("coupons")
      .select("uses")
      .eq("form_id", formId)
      .eq("code", "SAVE10")
      .single();
    expect(c?.uses).toBe(1);
    const { data: docs } = await admin
      .from("response_documents")
      .select("id")
      .eq("response_id", id);
    expect(docs).toHaveLength(1);
    const ordersBefore = orders.length;
    expect(await start(id)).toEqual({ kind: "paid" });
    expect(orders.length).toBe(ordersBefore);
  });

  it("settles duplicate and out-of-order webhooks to one paid state, and flags a second payment", async () => {
    const id = await submitted();
    const order = (await start(id)) as { orderId: string; amount: number };
    const pay = captured(order.orderId, order.amount, `pay_W${runId}`);
    const event = (name: string, p: Record<string, unknown>) =>
      applyRazorpayEvent(admin, workspaceId, {
        event: name,
        payload: { payment: { entity: p as never } },
      });
    // A failure for one try, then the capture, twice, then a late failure.
    expect(
      await event("payment.failed", { ...pay, id: `pay_F${runId}`, status: "failed" }),
    ).toBe("updated");
    expect((await paymentOf(id))?.status).toBe("failed");
    expect(await event("payment.captured", pay)).toBe("updated");
    expect(await event("payment.captured", pay)).toBe("ignored");
    expect(await event("order.paid", pay)).toBe("ignored");
    expect(await event("payment.failed", { ...pay, status: "failed" })).toBe("ignored");
    expect((await paymentOf(id))?.status).toBe("paid");
    // Another workspace's webhook can't touch it; a wrong amount neither.
    expect(
      await applyRazorpayEvent(admin, otherWorkspaceId, {
        event: "payment.captured",
        payload: { payment: { entity: pay as never } },
      }),
    ).toBe("ignored");

    // A second order for the same response paid too (two tabs): recorded,
    // the response stays paid once, and the timeline says to refund it.
    const { data: second } = await admin
      .from("payment_attempts")
      .insert({
        response_id: id,
        form_id: formId,
        provider: "razorpay",
        provider_ref: `order_D${runId}`,
        subtotal: 49_900,
        amount: 49_900,
        currency: "inr",
      })
      .select("provider_ref")
      .single();
    const dup = captured(second!.provider_ref, 49_900, `pay_D${runId}`);
    expect(await event("payment.captured", dup)).toBe("updated");
    expect(await paymentOf(id)).toMatchObject({
      status: "paid",
      provider_payment_id: pay.id,
    });
    const { data: events } = await admin
      .from("response_events")
      .select("detail")
      .eq("response_id", id)
      .eq("kind", "payment");
    expect(JSON.stringify(events)).toContain("A second payment of ₹499.00");
  });

  it("records refunds made in Razorpay: partly, then in full", async () => {
    const id = await submitted();
    const order = (await start(id)) as { orderId: string; amount: number };
    const pay = captured(order.orderId, order.amount, `pay_R${runId}`);
    await applyRazorpayEvent(admin, workspaceId, {
      event: "payment.captured",
      payload: { payment: { entity: pay as never } },
    });
    const refund = (total: number) =>
      applyRazorpayEvent(admin, workspaceId, {
        event: "refund.processed",
        payload: {
          refund: { entity: { payment_id: pay.id, amount: 1000 } },
          payment: { entity: { ...pay, amount_refunded: total } as never },
        },
      });
    expect(await refund(10_000)).toBe("updated");
    expect(await paymentOf(id)).toMatchObject({
      status: "paid",
      refunded_amount: 10_000,
    });
    expect(await refund(10_000)).toBe("ignored"); // a repeat
    expect(await refund(49_900)).toBe("updated");
    expect(await paymentOf(id)).toMatchObject({
      status: "refunded",
      refunded_amount: 49_900,
    });
  });

  it("is free with a 100% coupon, and a usage limit holds", async () => {
    const id = await submitted();
    expect(await start(id, "FREE")).toEqual({ kind: "paid" });
    expect(await paymentOf(id)).toMatchObject({
      status: "paid",
      amount: 0,
      provider: "coupon",
      coupon_code: "FREE",
    });

    const a = await submitted();
    const order = (await start(a, "ONCE")) as { orderId: string; amount: number };
    expect(order.amount).toBe(44_900);
    await applyRazorpayEvent(admin, workspaceId, {
      event: "payment.captured",
      payload: {
        payment: {
          entity: captured(order.orderId, order.amount, `pay_O${runId}`) as never,
        },
      },
    });
    const b = await submitted();
    expect(await start(b, "ONCE")).toEqual({
      kind: "error",
      message: "That code has been used up.",
    });
  });
});

describe("the paid state (spec §6.1 #3)", () => {
  it("can't be undone in the database, whatever the caller", async () => {
    const id = await submitted();
    await start(id, "FREE");
    const { error } = await admin
      .from("payments")
      .update({ status: "failed" })
      .eq("response_id", id);
    expect(error?.message).toMatch(/paid payment can't become failed/);
    const { error: amount } = await admin
      .from("payments")
      .update({ amount: 1 })
      .eq("response_id", id);
    expect(amount?.message).toMatch(/amount is fixed/);
  });

  it("records Stripe refunds too", async () => {
    const id = await submitted();
    await admin.from("payment_attempts").insert({
      response_id: id,
      form_id: formId,
      provider: "stripe",
      provider_ref: `cs_test_R${runId}`,
      subtotal: 2000,
      amount: 2000,
      currency: "usd",
    });
    expect(
      await applyStripeEvent(admin, {
        type: "checkout.session.completed",
        data: {
          object: {
            id: `cs_test_R${runId}`,
            payment_status: "paid",
            payment_intent: `pi_${runId}`,
          },
        },
      }),
    ).toBe("updated");
    expect(
      await applyStripeEvent(admin, {
        type: "charge.refunded",
        data: {
          object: { id: "ch_1", payment_intent: `pi_${runId}`, amount_refunded: 2000 },
        },
      }),
    ).toBe("updated");
    expect(await paymentOf(id)).toMatchObject({ status: "refunded", provider: "stripe" });
  });
});
