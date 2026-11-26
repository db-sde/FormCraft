import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { razorpayCall, verifyWebhookSignature } from "@/domains/payments/razorpay";
import { applySubscription, type SubscriptionState } from "./apply";
import { razorpayBilling, type BillingInterval } from "./config";

type Client = SupabaseClient<Database>;

type RazorpaySubscription = {
  id: string;
  plan_id: string;
  customer_id?: string | null;
  status: string;
  current_end?: number | null;
  notes?: Record<string, string> | unknown[];
  short_url?: string;
};

/** The Razorpay plan object for a price, made once and remembered. */
async function providerPlan(
  admin: Client,
  input: {
    planId: string;
    planName: string;
    interval: BillingInterval;
    amountMinor: number;
  },
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const keys = razorpayBilling();
  if (!keys) return null;
  const { data: known } = await admin.rpc("billing_provider_plan", {
    p_provider: "razorpay",
    p_plan_id: input.planId,
    p_interval: input.interval,
    p_currency: "inr",
    p_amount: input.amountMinor,
  });
  if (known) return known;
  const made = await razorpayCall<{ id: string }>(
    keys,
    "/v1/plans",
    {
      method: "POST",
      body: {
        period: input.interval === "month" ? "monthly" : "yearly",
        interval: 1,
        item: {
          name: `FormCraft ${input.planName} (${input.interval === "month" ? "monthly" : "yearly"})`,
          amount: input.amountMinor,
          currency: "INR",
        },
        notes: { plan_id: input.planId, interval: input.interval },
      },
    },
    fetchImpl,
  );
  if (!made.ok) return null;
  await admin.rpc("billing_remember_provider_plan", {
    p_provider: "razorpay",
    p_plan_id: input.planId,
    p_interval: input.interval,
    p_currency: "inr",
    p_amount: input.amountMinor,
    p_provider_plan_id: made.data.id,
  });
  return made.data.id;
}

/** A Razorpay subscription (cards and UPI autopay) in rupees: returns the
 * hosted page where the customer authorises it. */
export async function startRazorpaySubscription(
  admin: Client,
  input: {
    workspaceId: string;
    planId: string;
    planName: string;
    interval: BillingInterval;
    amountMinor: number;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const keys = razorpayBilling();
  if (!keys) return null;
  const plan = await providerPlan(admin, input, fetchImpl);
  if (!plan) return null;
  const sub = await razorpayCall<RazorpaySubscription>(
    keys,
    "/v1/subscriptions",
    {
      method: "POST",
      body: {
        plan_id: plan,
        total_count: input.interval === "month" ? 120 : 10,
        quantity: 1,
        customer_notify: 1,
        notes: {
          workspace_id: input.workspaceId,
          plan_id: input.planId,
          interval: input.interval,
        },
      },
    },
    fetchImpl,
  );
  if (!sub.ok || !sub.data.short_url) return null;
  await applySubscription(admin, {
    workspaceId: input.workspaceId,
    provider: "razorpay",
    subscriptionId: sub.data.id,
    customerId: null,
    planId: input.planId,
    interval: input.interval,
    currency: "inr",
    status: "pending",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  });
  return sub.data.short_url;
}

const STATUS: Record<string, SubscriptionState["status"]> = {
  created: "pending",
  authenticated: "pending",
  active: "active",
  pending: "past_due",
  halted: "past_due",
  paused: "past_due",
  cancelled: "ended",
  completed: "ended",
  expired: "ended",
};

async function razorpayState(
  admin: Client,
  sub: RazorpaySubscription,
): Promise<SubscriptionState | null> {
  const notes = (Array.isArray(sub.notes) ? {} : (sub.notes ?? {})) as Record<
    string,
    string
  >;
  if (!notes.workspace_id) return null;
  // A changed subscription keeps its first notes: its plan object says
  // which plan it's on now.
  const { data: mapped } = await admin.rpc("billing_plan_for_provider_plan", {
    p_provider: "razorpay",
    p_provider_plan_id: sub.plan_id,
  });
  const row = Array.isArray(mapped) ? mapped[0] : null;
  const planId = row?.plan_id ?? notes.plan_id;
  if (!planId) return null;
  return {
    workspaceId: notes.workspace_id,
    provider: "razorpay",
    subscriptionId: sub.id,
    customerId: sub.customer_id ?? null,
    planId,
    interval: (row?.billing_interval ?? notes.interval) === "year" ? "year" : "month",
    currency: "inr",
    status: STATUS[sub.status] ?? "pending",
    currentPeriodEnd: sub.current_end
      ? new Date(sub.current_end * 1000).toISOString()
      : null,
    cancelAtPeriodEnd: false,
  };
}

/** A signed Razorpay billing webhook, applied once per event. */
export async function handleRazorpayBillingWebhook(
  admin: Client,
  body: string,
  signature: string | null,
  eventId: string | null,
): Promise<{ status: number }> {
  const keys = razorpayBilling();
  if (!keys) return { status: 404 };
  if (!verifyWebhookSignature(body, signature, keys.webhookSecret))
    return { status: 400 };
  const event = JSON.parse(body) as {
    event: string;
    payload?: { subscription?: { entity?: RazorpaySubscription } };
  };
  if (!event.event.startsWith("subscription.")) return { status: 200 };
  const sub = event.payload?.subscription?.entity;
  if (!sub) return { status: 200 };
  const { data: fresh } = await admin.rpc("billing_claim_event", {
    p_provider: "razorpay",
    p_event_id: (eventId || `${sub.id}:${event.event}:${sub.current_end ?? ""}`).slice(
      0,
      200,
    ),
    p_type: event.event,
  });
  if (!fresh) return { status: 200 };
  const state = await razorpayState(admin, sub);
  if (state) await applySubscription(admin, state);
  return { status: 200 };
}

/** Changes the plan now (Razorpay charges the difference from the next
 * cycle). */
export async function changeRazorpayPlan(
  admin: Client,
  input: {
    subscriptionId: string;
    planId: string;
    planName: string;
    interval: BillingInterval;
    amountMinor: number;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const keys = razorpayBilling();
  if (!keys) return false;
  const plan = await providerPlan(admin, input, fetchImpl);
  if (!plan) return false;
  const res = await razorpayCall<RazorpaySubscription>(
    keys,
    `/v1/subscriptions/${input.subscriptionId}`,
    {
      method: "PATCH",
      body: { plan_id: plan, schedule_change_at: "now", customer_notify: 1 },
    },
    fetchImpl,
  );
  return res.ok;
}

/** Cancels at the end of the paid cycle. */
export async function cancelRazorpaySubscription(
  subscriptionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const keys = razorpayBilling();
  if (!keys) return false;
  const res = await razorpayCall(
    keys,
    `/v1/subscriptions/${subscriptionId}/cancel`,
    { method: "POST", body: { cancel_at_cycle_end: 1 } },
    fetchImpl,
  );
  return res.ok;
}
