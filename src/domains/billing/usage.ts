import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { withinLimit, type Entitlements } from "./entitlements";

type Client = SupabaseClient<Database>;

/**
 * Usage metering (PRD §8). Completed responses are counted by a database
 * trigger the moment a response completes; AI credits are counted here.
 * Seats and storage are measured from the rows themselves, so they can't
 * drift.
 *
 * Reaching a limit never loses a submission: responses past the monthly
 * limit are still stored and delivered; the creator sees an upgrade
 * prompt. Limits that are checked *before* an action (AI credits,
 * seats) stop the action with a message instead.
 */

export type Usage = {
  periodStart: string;
  completedResponses: number;
  aiCredits: number;
  members: number;
  storageMb: number;
};

export function currentPeriodStart(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function getUsage(
  supabase: Client,
  workspaceId: string,
  now = new Date(),
): Promise<Usage> {
  const periodStart = currentPeriodStart(now);
  const [counters, members, storage] = await Promise.all([
    supabase
      .from("usage_counters")
      .select("metric, value")
      .eq("workspace_id", workspaceId)
      .eq("period_start", periodStart),
    supabase
      .from("workspace_members")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    storageBytes(supabase, workspaceId),
  ]);
  if (counters.error) throw counters.error;
  if (members.error) throw members.error;
  const value = (metric: string) =>
    Number(counters.data?.find((c) => c.metric === metric)?.value ?? 0);
  return {
    periodStart,
    completedResponses: value("completed_responses"),
    aiCredits: value("ai_credits"),
    members: members.count ?? 0,
    storageMb: Math.round((storage / 1_048_576) * 10) / 10,
  };
}

async function storageBytes(supabase: Client, workspaceId: string): Promise<number> {
  let total = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("uploads")
      .select("size_bytes, responses!inner(forms!inner(workspace_id))")
      .eq("responses.forms.workspace_id", workspaceId)
      .neq("status", "deleted")
      .range(from, from + 999);
    if (error) throw error;
    for (const row of data ?? []) total += Number(row.size_bytes ?? 0);
    if ((data?.length ?? 0) < 1000) return total;
  }
}

/** One AI credit, if the plan has one left this month (service role). */
export async function spendAiCredit(
  admin: Client,
  workspaceId: string,
  entitlements: Entitlements,
): Promise<boolean> {
  const { data } = await admin
    .from("usage_counters")
    .select("value")
    .eq("workspace_id", workspaceId)
    .eq("metric", "ai_credits")
    .eq("period_start", currentPeriodStart())
    .maybeSingle();
  if (!withinLimit(entitlements, "ai_credits_per_month", Number(data?.value ?? 0))) {
    return false;
  }
  const { error } = await admin.rpc("increment_usage", {
    p_workspace_id: workspaceId,
    p_metric: "ai_credits",
    p_amount: 1,
  });
  if (error) throw error;
  return true;
}

export type UsageWarning = { metric: "responses" | "storage"; message: string };

/** What the creator should be told about limits right now. */
export function usageWarnings(usage: Usage, entitlements: Entitlements): UsageWarning[] {
  const warnings: UsageWarning[] = [];
  const responses = entitlements.responses_per_month;
  if (responses !== null && usage.completedResponses > responses) {
    warnings.push({
      metric: "responses",
      message: `You've had ${usage.completedResponses.toLocaleString()} responses this month, over your plan's ${responses.toLocaleString()}. They're all saved; upgrade to keep within your plan.`,
    });
  }
  const storage = entitlements.storage_mb;
  if (storage !== null && usage.storageMb > storage) {
    warnings.push({
      metric: "storage",
      message: `Uploaded files use ${usage.storageMb.toLocaleString()} MB, over your plan's ${storage.toLocaleString()} MB.`,
    });
  }
  return warnings;
}
