import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { audit } from "@/domains/audit/log";
import type { BillingInterval, BillingProvider } from "./config";

type Client = SupabaseClient<Database>;

export type SubscriptionState = {
  workspaceId: string;
  provider: BillingProvider;
  subscriptionId: string;
  customerId: string | null;
  planId: string;
  interval: BillingInterval;
  currency: "usd" | "inr";
  status: "pending" | "active" | "past_due" | "cancelled" | "ended";
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

/** Applies what the provider says about a subscription: the database
 * moves the workspace's plan, and a plan change is audited. */
export async function applySubscription(
  admin: Client,
  s: SubscriptionState,
): Promise<void> {
  const { data, error } = await admin.rpc("billing_apply_subscription", {
    p_workspace_id: s.workspaceId,
    p_provider: s.provider,
    p_subscription_id: s.subscriptionId,
    p_customer_id: s.customerId as string,
    p_plan_id: s.planId,
    p_interval: s.interval,
    p_currency: s.currency,
    p_status: s.status,
    p_current_period_end: s.currentPeriodEnd as string,
    p_cancel_at_period_end: s.cancelAtPeriodEnd,
  });
  if (error) throw error;
  const result = data as { plan_changed: boolean; from: string; to: string } | null;
  if (result?.plan_changed) {
    await audit(admin, {
      workspaceId: s.workspaceId,
      actorId: null,
      action:
        result.to === "free"
          ? "billing.subscription_cancelled"
          : "billing.subscription_changed",
      target: { type: "subscription", id: s.subscriptionId },
      metadata: {
        provider: s.provider,
        from: result.from,
        to: result.to,
        status: s.status,
      },
      requestId: null,
    });
  }
}
