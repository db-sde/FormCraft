import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { Entitlements } from "./entitlements";

type Client = SupabaseClient<Database>;

/**
 * Usage metering (PRD §8). Completed responses are counted by a database
 * trigger the moment a response completes; AI credits are taken by the AI
 * gateway (domains/ai/gateway.ts) when a call is allowed.
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
  /** Google address lookups this month (F-65): billed to the operator's
   * Google account, shown so the cost can be watched. */
  placesLookups: number;
  /** Notification emails sent this month (counted against the plan). */
  emails: number;
  /** Addresses picked with Google suggestions (counted against the plan). */
  addressLookups: number;
  members: number;
  storageMb: number;
  /** Of which video and audio answers (roadmap #21). */
  recordingsMb: number;
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
    placesLookups: value("places_lookups"),
    emails: value("emails"),
    addressLookups: value("address_lookups"),
    members: members.count ?? 0,
    storageMb: Math.round((storage.total / 1_048_576) * 10) / 10,
    recordingsMb: Math.round((storage.recordings / 1_048_576) * 10) / 10,
  };
}

async function storageBytes(
  supabase: Client,
  workspaceId: string,
): Promise<{ total: number; recordings: number }> {
  let total = 0;
  let recordings = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("uploads")
      .select("size_bytes, mime_type, responses!inner(forms!inner(workspace_id))")
      .eq("responses.forms.workspace_id", workspaceId)
      .neq("status", "deleted")
      .range(from, from + 999);
    if (error) throw error;
    for (const row of data ?? []) {
      const size = Number(row.size_bytes ?? 0);
      total += size;
      if (/^(audio|video)\//.test(row.mime_type)) recordings += size;
    }
    if ((data?.length ?? 0) < 1000) return { total, recordings };
  }
}

export type UsageWarning = {
  metric: "responses" | "storage" | "emails" | "ai" | "addresses";
  message: string;
};

/** What the creator should be told about limits right now. */
export function usageWarnings(usage: Usage, entitlements: Entitlements): UsageWarning[] {
  const warnings: UsageWarning[] = [];
  const responses = entitlements.responses_per_month;
  // Responses are never refused: above the fair-use level FormCraft may
  // get in touch about a bigger plan (pricing doc).
  if (responses !== null && usage.completedResponses > responses) {
    warnings.push({
      metric: "responses",
      message: `You've had ${usage.completedResponses.toLocaleString()} responses this month, above your plan's fair-use level of ${responses.toLocaleString()}. Every response is saved and delivered; we may get in touch about a plan that fits.`,
    });
  }
  const storage = entitlements.storage_mb;
  if (storage !== null && usage.storageMb >= storage) {
    warnings.push({
      metric: "storage",
      message: `File storage is full (${usage.storageMb.toLocaleString()} of ${storage.toLocaleString()} MB). Forms stop accepting new files until you delete some or upgrade; answers are still saved.`,
    });
  } else if (storage !== null && usage.storageMb >= storage * 0.8) {
    warnings.push({
      metric: "storage",
      message: `File storage is ${Math.round((usage.storageMb / storage) * 100)}% used (${usage.storageMb.toLocaleString()} of ${storage.toLocaleString()} MB).`,
    });
  }
  const emails = entitlements.emails_per_month;
  if (emails !== null && usage.emails >= emails) {
    warnings.push({
      metric: "emails",
      message: `This month's ${emails.toLocaleString()} notification emails are used. You get one summary a day instead of an email per response until the 1st.`,
    });
  }
  const credits = entitlements.ai_credits_per_month;
  if (credits !== null && credits > 0 && usage.aiCredits >= credits) {
    warnings.push({
      metric: "ai",
      message: "This month's AI credits are used. AI features pause until the 1st.",
    });
  }
  const lookups = entitlements.address_lookups_per_month;
  if (lookups !== null && lookups > 0 && usage.addressLookups >= lookups) {
    warnings.push({
      metric: "addresses",
      message:
        "This month's address suggestions are used. Respondents type addresses until the 1st.",
    });
  }
  return warnings;
}
