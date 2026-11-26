import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getWorkspacePlan, type Entitlements } from "./entitlements";
import { currentPeriodStart } from "./usage";

type Client = SupabaseClient<Database>;

/**
 * Monthly quotas that cost FormCraft money per use (pricing doc: "hard
 * limits in code, not only on the pricing page"). Each take is one
 * database statement (spend_usage), so two requests at once can't both
 * take the last unit. AI credits are taken by the AI gateway.
 */
export type QuotaMetric = "emails" | "address_lookups";

const LIMIT_KEY: Record<QuotaMetric, keyof Entitlements> = {
  emails: "emails_per_month",
  address_lookups: "address_lookups_per_month",
};

/** No limit, for the database function (its argument is nullable). */
const SQL_NULL_LIMIT = null as unknown as number;

/**
 * Takes `amount` from the workspace's monthly allowance. False when it
 * would go over (nothing is taken). With `countOnly`, the use is recorded
 * but never refused (a booking confirmation to a respondent).
 */
export async function takeQuota(
  admin: Client,
  workspaceId: string,
  metric: QuotaMetric,
  amount = 1,
  options: { countOnly?: boolean; entitlements?: Entitlements } = {},
): Promise<boolean> {
  if (amount <= 0) return true;
  const entitlements =
    options.entitlements ?? (await getWorkspacePlan(admin, workspaceId)).entitlements;
  const limit = options.countOnly
    ? SQL_NULL_LIMIT
    : ((entitlements[LIMIT_KEY[metric]] as number | null) ?? SQL_NULL_LIMIT);
  const { data, error } = await admin.rpc("spend_usage", {
    p_workspace_id: workspaceId,
    p_metric: metric,
    p_limit: limit,
    p_amount: amount,
  });
  if (error) throw error;
  return data !== null;
}

/** How much of a quota is used this month. */
export async function quotaUsed(
  admin: Client,
  workspaceId: string,
  metric: QuotaMetric,
): Promise<number> {
  const { data } = await admin
    .from("usage_counters")
    .select("value")
    .eq("workspace_id", workspaceId)
    .eq("metric", metric)
    .eq("period_start", currentPeriodStart())
    .maybeSingle();
  return Number(data?.value ?? 0);
}

/**
 * Once per month per threshold: true the first time it's asked, false
 * after (for "you've used 80% of your storage" warnings).
 */
export async function firstTimeThisMonth(
  admin: Client,
  workspaceId: string,
  key: "storage_80" | "storage_95" | "emails_80" | "emails_100",
): Promise<boolean> {
  const { data, error } = await admin.rpc("spend_usage", {
    p_workspace_id: workspaceId,
    p_metric: `warned_${key}`,
    p_limit: 1,
    p_amount: 1,
  });
  if (error) return false;
  return data !== null;
}
