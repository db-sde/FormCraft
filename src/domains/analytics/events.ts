import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { AnalyticsEventLite } from "./completion-rate";

type Client = SupabaseClient<Database>;

export const ANALYTICS_EVENT_TYPES = [
  "form_viewed",
  "form_started",
  "form_submitted",
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

/** Read path for the dashboard's funnel/completion-rate widgets. */
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
