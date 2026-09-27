export type ResponseStatus = "in_progress" | "partial" | "completed";

const ALLOWED_TRANSITIONS: Record<ResponseStatus, ResponseStatus[]> = {
  in_progress: ["in_progress", "partial", "completed"],
  partial: ["partial", "completed"],
  completed: ["completed"],
};

/**
 * Mirrors the DB trigger `enforce_response_status_transition` (see
 * supabase/migrations/00000000000003_responses_and_answers.sql) so the
 * application layer can reject an invalid transition with a clear typed
 * error before ever issuing the write, rather than relying solely on the
 * database to catch it.
 */
export function canTransition(from: ResponseStatus, to: ResponseStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export class InvalidResponseTransitionError extends Error {
  constructor(
    public readonly from: ResponseStatus,
    public readonly to: ResponseStatus,
  ) {
    super(`invalid response status transition: ${from} -> ${to}`);
    this.name = "InvalidResponseTransitionError";
  }
}

export function assertTransition(from: ResponseStatus, to: ResponseStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidResponseTransitionError(from, to);
  }
}

/**
 * Mirrors the DB's monotonic client_revision guard. An incoming autosave
 * write is accepted only if its revision is strictly greater than the
 * currently stored one — this is what makes out-of-order/stale autosaves
 * (a delayed retry, a second tab) safe to just drop rather than corrupt
 * state.
 */
export function isRevisionAcceptable(
  storedRevision: number,
  incomingRevision: number,
): boolean {
  return incomingRevision > storedRevision;
}
