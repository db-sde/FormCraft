"use server";

import { SWITCHED_OFF, featureEnabled } from "@/domains/flags";
import { z } from "zod";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { canAdmin } from "@/domains/workspaces";
import { recordAudit } from "@/domains/audit/record";
import { createAdminClient } from "@/lib/supabase/admin";
import { PLAN_NAMES } from "@/domains/billing/catalog";
import {
  billingProviders,
  periodAmountMinor,
  type BillingInterval,
  type BillingProvider,
} from "@/domains/billing/checkout/config";
import {
  changeStripePlan,
  setStripeCancelAtPeriodEnd,
  startStripeCheckout,
  stripePortalUrl,
  stripeState,
} from "@/domains/billing/checkout/stripe";
import {
  cancelRazorpaySubscription,
  changeRazorpayPlan,
  startRazorpaySubscription,
} from "@/domains/billing/checkout/razorpay";
import { applySubscription } from "@/domains/billing/checkout/apply";
import { rateLimit } from "@/domains/abuse/limit";

type Result = { ok: true; url?: string } | { ok: false; message: string };

const Choice = z.object({
  planId: z.enum(["starter", "pro", "business"]),
  interval: z.enum(["month", "year"]),
  provider: z.enum(["stripe", "razorpay"]),
});

async function ownerOrAdmin() {
  const ctx = await getCurrentWorkspace();
  if (!canAdmin(ctx.workspace.role)) return null;
  return ctx;
}

/** The workspace's live subscription, if any. */
async function currentSubscription(workspaceId: string) {
  const { data } = await createAdminClient()
    .from("billing_subscriptions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .in("status", ["active", "past_due", "pending"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function price(planId: string, provider: BillingProvider) {
  const { data } = await createAdminClient()
    .from("plans")
    .select("monthly_usd, annual_usd, monthly_inr, annual_inr")
    .eq("id", planId)
    .eq("is_public", true)
    .single();
  if (!data) return null;
  return provider === "stripe"
    ? { monthly: Number(data.monthly_usd), annual: Number(data.annual_usd) }
    : { monthly: Number(data.monthly_inr), annual: Number(data.annual_inr) };
}

/** Starts checkout for a plan: Stripe (US dollars) or Razorpay (rupees).
 * The plan changes when the provider confirms the payment, never here. */
export async function startCheckoutAction(input: unknown): Promise<Result> {
  const parsed = Choice.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a plan." };
  const ctx = await ownerOrAdmin();
  if (!ctx)
    return { ok: false, message: "Only the owner and admins can change the plan." };
  const { planId, interval, provider } = parsed.data;
  if (!billingProviders().includes(provider))
    return { ok: false, message: "That way of paying isn't set up yet." };
  if (!(await featureEnabled("checkout", ctx.workspace.id)))
    return { ok: false, message: SWITCHED_OFF };
  if (!(await rateLimit(`checkout:${ctx.workspace.id}`, 20, 3_600_000)).allowed)
    return { ok: false, message: "Too many tries. Try again in a little while." };
  const { data: ws } = await ctx.supabase
    .from("workspaces")
    .select("plan_id")
    .eq("id", ctx.workspace.id)
    .single();
  if (ws?.plan_id === "enterprise")
    return {
      ok: false,
      message: "This workspace is on a contract. Talk to us to change it.",
    };
  const existing = await currentSubscription(ctx.workspace.id);
  if (existing && existing.status !== "pending")
    return changePlanAction({ planId, interval });
  const p = await price(planId, provider);
  if (!p) return { ok: false, message: "Choose a plan." };
  const amountMinor = periodAmountMinor(p, interval as BillingInterval);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const admin = createAdminClient();
  const url =
    provider === "stripe"
      ? await startStripeCheckout({
          workspaceId: ctx.workspace.id,
          planId,
          planName: PLAN_NAMES[planId],
          interval,
          amountMinor,
          email: ctx.user.email ?? null,
          customerId: null,
          successUrl: `${appUrl}/settings?tab=plan&checkout=stripe&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${appUrl}/settings?tab=plan&checkout=cancelled`,
        })
      : await startRazorpaySubscription(admin, {
          workspaceId: ctx.workspace.id,
          planId,
          planName: PLAN_NAMES[planId],
          interval,
          amountMinor,
        });
  if (!url) return { ok: false, message: "Checkout didn't start. Please try again." };
  await recordAudit({
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    action: "billing.checkout_started",
    metadata: { provider, planId, interval },
  });
  return { ok: true, url };
}

/** Moves an existing subscription to another plan or billing period. */
export async function changePlanAction(input: unknown): Promise<Result> {
  const parsed = Choice.omit({ provider: true }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a plan." };
  const ctx = await ownerOrAdmin();
  if (!ctx)
    return { ok: false, message: "Only the owner and admins can change the plan." };
  const sub = await currentSubscription(ctx.workspace.id);
  if (!sub || sub.status === "pending")
    return { ok: false, message: "There's no subscription to change." };
  const provider = sub.provider as BillingProvider;
  const p = await price(parsed.data.planId, provider);
  if (!p) return { ok: false, message: "Choose a plan." };
  const change = {
    subscriptionId: sub.provider_subscription_id,
    planId: parsed.data.planId,
    planName: PLAN_NAMES[parsed.data.planId],
    interval: parsed.data.interval as BillingInterval,
    amountMinor: periodAmountMinor(p, parsed.data.interval as BillingInterval),
  };
  const admin = createAdminClient();
  if (provider === "stripe") {
    const updated = await changeStripePlan(change);
    const state = updated ? stripeState(updated) : null;
    if (!state)
      return { ok: false, message: "Stripe didn't change the plan. Try again." };
    await applySubscription(admin, state);
  } else if (!(await changeRazorpayPlan(admin, change))) {
    return { ok: false, message: "Razorpay didn't change the plan. Try again." };
  }
  await recordAudit({
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    action: "billing.subscription_changed",
    metadata: {
      provider,
      planId: change.planId,
      interval: change.interval,
      requested: true,
    },
  });
  return { ok: true };
}

/** Cancels at the end of the paid period (Free after that; data stays),
 * or undoes a cancellation (Stripe). */
export async function setCancelAction(cancel: boolean): Promise<Result> {
  const ctx = await ownerOrAdmin();
  if (!ctx)
    return { ok: false, message: "Only the owner and admins can change the plan." };
  const sub = await currentSubscription(ctx.workspace.id);
  if (!sub) return { ok: false, message: "There's no subscription." };
  const admin = createAdminClient();
  if (sub.provider === "stripe") {
    const updated = await setStripeCancelAtPeriodEnd(
      sub.provider_subscription_id,
      cancel,
    );
    const state = updated ? stripeState(updated) : null;
    if (!state)
      return { ok: false, message: "Stripe didn't make the change. Try again." };
    await applySubscription(admin, state);
  } else {
    if (!cancel) return { ok: false, message: "Choose the plan again to restart it." };
    if (!(await cancelRazorpaySubscription(sub.provider_subscription_id)))
      return { ok: false, message: "Razorpay didn't cancel it. Try again." };
    await admin
      .from("billing_subscriptions")
      .update({ cancel_at_period_end: true })
      .eq("id", sub.id);
  }
  await recordAudit({
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    action: "billing.subscription_cancelled",
    metadata: { provider: sub.provider, atPeriodEnd: true, undo: !cancel },
  });
  return { ok: true };
}

/** Stripe's billing portal (cards, invoices). */
export async function billingPortalAction(): Promise<Result> {
  const ctx = await ownerOrAdmin();
  if (!ctx) return { ok: false, message: "Only the owner and admins can see billing." };
  const sub = await currentSubscription(ctx.workspace.id);
  if (!sub || sub.provider !== "stripe" || !sub.provider_customer_id)
    return { ok: false, message: "There's no card subscription." };
  const url = await stripePortalUrl(
    sub.provider_customer_id,
    `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/settings?tab=plan`,
  );
  return url
    ? { ok: true, url }
    : { ok: false, message: "Stripe didn't open it. Try again." };
}
