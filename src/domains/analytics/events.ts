import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { AnalyticsEventLite, FunnelSummary } from "./completion-rate";

type Client = SupabaseClient<Database>;

export const ANALYTICS_EVENT_TYPES = [
  // Respondent funnel (drive Views / Starts / Completed).
  "form_viewed",
  "form_started",
  "form_submitted",
  // Respondent step events (PRD §3.6) — question ids only, never values.
  "question_viewed",
  "question_answered",
  // Creator product events.
  "form_created",
  "question_added",
  "form_previewed",
  "form_published",
  "form_unpublished",
  "integration_connected",
  "export_completed",
] as const;
export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

/**
 * Records one funnel event to our own `analytics_events` table — the
 * source of truth computeFunnelSummary/computeCompletionRate read from
 * (see completion-rate.ts's doc comment on why raw view/request counts
 * from anywhere else must never substitute for this). Deliberately a
 * thin query-layer function like the rest of this file's siblings
 * across domains (no "server-only", so integration tests can call it
 * directly with a service-role client the same way route handlers do)
 * — PostHog capture is a separate, best-effort concern handled by
 * @/lib/analytics/posthog-server's captureServerEvent, called
 * alongside this at each call site.
 */
export async function recordAnalyticsEvent(
  admin: Client,
  params: {
    formId: string;
    eventType: AnalyticsEventType;
    isPreview?: boolean;
    sessionId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { formId, eventType, isPreview = false, sessionId, metadata } = params;

  const { error } = await admin.from("analytics_events").insert({
    form_id: formId,
    event_type: eventType,
    is_preview: isPreview,
    session_id: sessionId ?? null,
    metadata: (metadata ?? {}) as Json,
  });
  if (error) throw error;
}

/**
 * Read path for the dashboard's funnel/completion-rate widgets. Counts
 * in the database rather than fetching rows: PostgREST caps a select at
 * max_rows (1000), so counting fetched rows silently undercounted any
 * form past a thousand events. Preview traffic is excluded at the
 * source, same as computeFunnelSummary.
 */
export async function getFunnelSummaryForForm(
  supabase: Client,
  formId: string,
  /** Only count events at or after this instant (PRD P1.20 "selected
   * period"); omit for all time. */
  since?: Date,
): Promise<FunnelSummary> {
  const count = async (eventType: AnalyticsEventType) => {
    let query = supabase
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("form_id", formId)
      .eq("event_type", eventType)
      .eq("is_preview", false);
    if (since) query = query.gte("created_at", since.toISOString());
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  };

  const [views, starts, completions] = await Promise.all([
    count("form_viewed"),
    count("form_started"),
    count("form_submitted"),
  ]);
  return {
    views,
    starts,
    completions,
    completionRate: starts === 0 ? null : (completions / starts) * 100,
  };
}

/** Raw event rows — for tests and debugging; the dashboard uses
 * getFunnelSummaryForForm, which isn't subject to the row cap. */
export async function listAnalyticsEventsForForm(
  supabase: Client,
  formId: string,
): Promise<AnalyticsEventLite[]> {
  const { data, error } = await supabase
    .from("analytics_events")
    .select("event_type, is_preview")
    .eq("form_id", formId);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    eventType: row.event_type,
    isPreview: row.is_preview,
  }));
}
