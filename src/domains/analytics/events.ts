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
 * The funnel behind the Views / Started / Completed / Completion-rate
 * cards. Views come from analytics events (nothing else records a page
 * view). Starts and completions come from the canonical `responses`
 * table, counted for responses *started* in the period — so the cards
 * always agree with the response lists, deleting a response is
 * reflected immediately, and the completion rate is a true cohort rate
 * (never above 100%). Everything is counted in the database: PostgREST
 * caps a select at 1000 rows, so counting fetched rows silently
 * undercounted any popular form. Preview traffic is excluded at the
 * source.
 */
export async function getFunnelSummaryForForm(
  supabase: Client,
  formId: string,
  /** Only count activity at or after this instant (PRD P1.20 "selected
   * period"); omit for all time. */
  since?: Date,
): Promise<FunnelSummary> {
  const sinceIso = since?.toISOString();

  const viewsQuery = supabase
    .from("analytics_events")
    .select("id", { count: "exact", head: true })
    .eq("form_id", formId)
    .eq("event_type", "form_viewed")
    .eq("is_preview", false);
  const startsQuery = supabase
    .from("responses")
    .select("id", { count: "exact", head: true })
    .eq("form_id", formId)
    .eq("is_preview", false);
  const completionsQuery = supabase
    .from("responses")
    .select("id", { count: "exact", head: true })
    .eq("form_id", formId)
    .eq("is_preview", false)
    .eq("status", "completed");

  const [views, starts, completions] = await Promise.all(
    [
      sinceIso ? viewsQuery.gte("created_at", sinceIso) : viewsQuery,
      sinceIso ? startsQuery.gte("started_at", sinceIso) : startsQuery,
      sinceIso ? completionsQuery.gte("started_at", sinceIso) : completionsQuery,
    ].map(async (query) => {
      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    }),
  );

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
