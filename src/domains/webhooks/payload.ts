import type { AnswerMap } from "@/domains/logic";

export type WebhookPayload = {
  eventId: string;
  eventType: "response.completed";
  formId: string;
  responseId: string;
  submittedAt: string;
  endingId: string | null;
  answers: AnswerMap;
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
}): WebhookPayload {
  return {
    eventId: input.eventId,
    eventType: "response.completed",
    formId: input.formId,
    responseId: input.responseId,
    submittedAt: input.submittedAt,
    endingId: input.endingId,
    answers: input.answers,
  };
}

/** The exact string that gets sent and signed — one function, so the
 * two can never drift apart. */
export function serializeWebhookPayload(payload: WebhookPayload): string {
  return JSON.stringify(payload);
}
