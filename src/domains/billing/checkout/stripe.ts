import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { stripeApiBase, verifyStripeSignature } from "@/domains/payments/stripe";
import { applySubscription, type SubscriptionState } from "./apply";
import { stripeBilling, type BillingInterval } from "./config";

type Client = SupabaseClient<Database>;

type StripeSubscription = {
  id: string;
  customer: string | null;
  status: string;
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: {
    data: {
      id: string;
      current_period_end?: number;
      price?: { product?: string; recurring?: { interval?: string } };
    }[];
  };
};

async function stripe<T>(
  path: string,
  params?: Record<string, string>,
  method: "GET" | "POST" = params ? "POST" : "GET",
  fetchImpl: typeof fetch = fetch,
): Promise<T | null> {
  const keys = stripeBilling();
  if (!keys) return null;
  const res = await fetchImpl(`${stripeApiBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${keys.secretKey}`,
      ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json()) as T;
}

/** A Stripe Checkout for a subscription to a plan, in US dollars. */
export async function startStripeCheckout(
  input: {
    workspaceId: string;
    planId: string;
    planName: string;
    interval: BillingInterval;
    amountMinor: number;
    email: string | null;
    customerId: string | null;
    successUrl: string;
    cancelUrl: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const meta = {
    workspace_id: input.workspaceId,
    plan_id: input.planId,
    interval: input.interval,
  };
  const session = await stripe<{ url?: string }>(
    "/v1/checkout/sessions",
    {
      mode: "subscription",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(input.amountMinor),
      "line_items[0][price_data][recurring][interval]": input.interval,
      "line_items[0][price_data][product_data][name]": `FormCraft ${input.planName}`,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.workspaceId,
      allow_promotion_codes: "true",
      ...(input.customerId
        ? { customer: input.customerId }
        : input.email
          ? { customer_email: input.email }
          : {}),
      ...Object.fromEntries(Object.entries(meta).map(([k, v]) => [`metadata[${k}]`, v])),
      ...Object.fromEntries(
        Object.entries(meta).map(([k, v]) => [`subscription_data[metadata][${k}]`, v]),
      ),
    },
    "POST",
    fetchImpl,
  );
  return session?.url ?? null;
}

const STATUS: Record<string, SubscriptionState["status"]> = {
  active: "active",
  trialing: "active",
  past_due: "past_due",
  unpaid: "past_due",
  canceled: "ended",
  incomplete: "pending",
  incomplete_expired: "ended",
  paused: "past_due",
};

/** A Stripe subscription as FormCraft's state, if it's one of ours. */
export function stripeState(sub: StripeSubscription): SubscriptionState | null {
  const m = sub.metadata ?? {};
  if (!m.workspace_id || !m.plan_id) return null;
  const end = sub.current_period_end ?? sub.items?.data[0]?.current_period_end;
  return {
    workspaceId: m.workspace_id,
    provider: "stripe",
    subscriptionId: sub.id,
    customerId: sub.customer ?? null,
    planId: m.plan_id,
    interval: m.interval === "year" ? "year" : "month",
    currency: "usd",
    status: STATUS[sub.status] ?? "pending",
    currentPeriodEnd: end ? new Date(end * 1000).toISOString() : null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  };
}

/** After Checkout returns: ask Stripe about the session (the browser's
 * return proves nothing on its own) and apply its subscription. */
export async function syncStripeCheckout(
  admin: Client,
  sessionId: string,
  workspaceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return false;
  const session = await stripe<{
    client_reference_id?: string;
    subscription?: StripeSubscription | null;
  }>(
    `/v1/checkout/sessions/${sessionId}?expand[]=subscription`,
    undefined,
    "GET",
    fetchImpl,
  );
  if (!session || session.client_reference_id !== workspaceId || !session.subscription)
    return false;
  const state = stripeState(session.subscription);
  if (!state || state.workspaceId !== workspaceId) return false;
  await applySubscription(admin, state);
  return true;
}

/** A signed Stripe billing webhook, applied once per event. */
export async function handleStripeBillingWebhook(
  admin: Client,
  body: string,
  signature: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number }> {
  const keys = stripeBilling();
  if (!keys) return { status: 404 };
  if (!verifyStripeSignature(body, signature, keys.webhookSecret)) return { status: 400 };
  const event = JSON.parse(body) as {
    id: string;
    type: string;
    data: { object: Record<string, unknown> };
  };
  const { data: fresh } = await admin.rpc("billing_claim_event", {
    p_provider: "stripe",
    p_event_id: event.id,
    p_type: event.type,
  });
  if (!fresh) return { status: 200 };
  let sub: StripeSubscription | null = null;
  if (event.type === "checkout.session.completed") {
    const id = event.data.object.subscription;
    if (typeof id === "string")
      sub = await stripe<StripeSubscription>(
        `/v1/subscriptions/${id}`,
        undefined,
        "GET",
        fetchImpl,
      );
  } else if (event.type.startsWith("customer.subscription.")) {
    sub = event.data.object as unknown as StripeSubscription;
  }
  const state = sub ? stripeState(sub) : null;
  if (state) await applySubscription(admin, state);
  return { status: 200 };
}

/** Moves a subscription to another plan or interval, prorated. */
export async function changeStripePlan(
  input: {
    subscriptionId: string;
    planId: string;
    planName: string;
    interval: BillingInterval;
    amountMinor: number;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<StripeSubscription | null> {
  const sub = await stripe<StripeSubscription>(
    `/v1/subscriptions/${input.subscriptionId}`,
    undefined,
    "GET",
    fetchImpl,
  );
  const item = sub?.items?.data[0];
  if (!sub || !item) return null;
  const product = await stripe<{ id: string }>(
    "/v1/products",
    { name: `FormCraft ${input.planName}` },
    "POST",
    fetchImpl,
  );
  if (!product) return null;
  return stripe<StripeSubscription>(
    `/v1/subscriptions/${input.subscriptionId}`,
    {
      "items[0][id]": item.id,
      "items[0][price_data][currency]": "usd",
      "items[0][price_data][product]": product.id,
      "items[0][price_data][unit_amount]": String(input.amountMinor),
      "items[0][price_data][recurring][interval]": input.interval,
      proration_behavior: "create_prorations",
      cancel_at_period_end: "false",
      "metadata[plan_id]": input.planId,
      "metadata[interval]": input.interval,
    },
    "POST",
    fetchImpl,
  );
}

/** Cancels at the end of the paid period, or undoes that. */
export function setStripeCancelAtPeriodEnd(
  subscriptionId: string,
  cancel: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<StripeSubscription | null> {
  return stripe<StripeSubscription>(
    `/v1/subscriptions/${subscriptionId}`,
    { cancel_at_period_end: String(cancel) },
    "POST",
    fetchImpl,
  );
}

/** Stripe's billing portal: cards, invoices and receipts. */
export async function stripePortalUrl(
  customerId: string,
  returnUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const session = await stripe<{ url?: string }>(
    "/v1/billing_portal/sessions",
    { customer: customerId, return_url: returnUrl },
    "POST",
    fetchImpl,
  );
  return session?.url ?? null;
}

export type { StripeSubscription };
