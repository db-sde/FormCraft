import "server-only";
import { after } from "next/server";
import { recordAnalyticsEvent, type AnalyticsEventType } from "@/domains/analytics";
import { createAdminClient } from "@/lib/supabase/admin";
import { captureServerEvent } from "./posthog-server";

/**
 * Records a product event (our analytics_events table + PostHog) after
 * the response is sent, never affecting the action it describes. Pass
 * ids and small descriptive metadata only — never respondent answers
 * (PRD §3.6).
 */
export function trackEvent(params: {
  formId: string;
  eventType: AnalyticsEventType;
  /** Creator user id or respondent response id, for PostHog. */
  actorId?: string | null;
  sessionId?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  after(async () => {
    try {
      await recordAnalyticsEvent(createAdminClient(), {
        formId: params.formId,
        eventType: params.eventType,
        sessionId: params.sessionId,
        metadata: params.metadata,
      });
    } catch {
      // Best effort — analytics never breaks the product.
    }
    await captureServerEvent({
      distinctId: params.actorId ?? params.sessionId ?? params.formId,
      event: params.eventType,
      properties: { formId: params.formId, ...params.metadata },
    });
  });
}
