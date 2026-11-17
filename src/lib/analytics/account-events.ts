import { currentRequestId } from "@/lib/http/request-id";

/**
 * The account-level events (foundations §2), defined once: signup,
 * activation, payments and AI use. Form-level product events stay in
 * ANALYTICS_EVENT_TYPES (domains/analytics/events.ts). Sent to PostHog
 * only, with the request id; never answers or personal details. Never
 * throws, and safe to import anywhere (PostHog is loaded only when sent).
 */
export const ACCOUNT_EVENTS = [
  "signup_completed",
  "workspace_activated",
  "payment_succeeded",
  "payment_refunded",
  "ai_used",
  "captcha_failed",
] as const;
export type AccountEvent = (typeof ACCOUNT_EVENTS)[number];

export async function trackAccountEvent(params: {
  event: AccountEvent;
  distinctId: string;
  workspaceId?: string | null;
  properties?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  try {
    const { captureServerEvent } = await import("./posthog-server");
    await captureServerEvent({
      distinctId: params.distinctId,
      event: params.event,
      properties: {
        workspaceId: params.workspaceId ?? null,
        requestId: await currentRequestId(),
        ...params.properties,
      },
    });
  } catch {
    // Analytics never breaks the action it describes.
  }
}
