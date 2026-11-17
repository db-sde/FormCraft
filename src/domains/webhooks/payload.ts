import type { AnswerMap } from "@/domains/logic";

/** What an endpoint can be sent (F-53). Without its own list an endpoint
 * gets completed responses only. */
export const WEBHOOK_EVENTS = [
  "response.completed",
  "response.partial_saved",
  "response.abandoned",
  "response.resumed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export type WebhookPayload = {
  eventId: string;
  eventType: WebhookEvent;
  formId: string;
  responseId: string;
  /** When it was submitted; null for an event about an unfinished one. */
  submittedAt: string | null;
  /** Unfinished-response events: when it happened, the response's state
   * and the last question reached. */
  occurredAt?: string;
  status?: "in_progress" | "partial" | "completed";
  lastQuestionId?: string | null;
  endingId: string | null;
  answers: AnswerMap;
  /** Computed results (scores, totals, segments), by variable name. */
  variables: Record<string, unknown>;
  /** The URL / hidden-field values the response started with. */
  hidden: Record<string, string>;
};

/** Deterministic key ordering so the same logical event always
 * serializes identically — not load-bearing for signature
 * verification (the signature covers whatever string is actually
 * sent), but keeps deliveries reproducible/diffable for debugging. */
export function buildWebhookPayload(input: {
  eventId: string;
  formId: string;
  responseId: string;
  submittedAt: string;
  endingId: string | null;
  answers: AnswerMap;
  variables?: Record<string, unknown>;
  hidden?: Record<string, string>;
}): WebhookPayload {
  return {
    eventId: input.eventId,
    eventType: "response.completed",
    formId: input.formId,
    responseId: input.responseId,
    submittedAt: input.submittedAt,
    endingId: input.endingId,
    answers: input.answers,
    variables: input.variables ?? {},
    hidden: input.hidden ?? {},
  };
}

/** The exact string that gets sent and signed — one function, so the
 * two can never drift apart. */
export function serializeWebhookPayload(payload: WebhookPayload): string {
  return JSON.stringify(payload);
}
