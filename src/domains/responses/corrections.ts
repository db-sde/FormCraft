import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { QuestionType } from "@/domains/forms/schema/question-types";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { hasAnswer, validateAnswer } from "@/domains/logic/validate-answer";
import { normalizeAnswer } from "./queries";

type Client = SupabaseClient<Database>;

/**
 * Corrections to submitted answers (roadmap #55). A teammate with the
 * "Correct submitted answers" permission fixes an ordinary answer — a
 * typo in an email, the wrong date — giving a reason. The database keeps
 * every value it replaced (`answer_revisions`, migration 67), so the
 * respondent's original is always recoverable, and adds a timeline entry.
 *
 * Only these types can be corrected. Signatures, orders, consent, uploads,
 * bookings and the structured answers (address, contact, matrix, ranking,
 * groups, date ranges) are refused: some are evidence that mustn't be
 * rewritten, the rest need an editor of their own. The database refuses
 * the same list whatever calls it.
 */
export const CORRECTABLE_TYPES: ReadonlySet<QuestionType> = new Set([
  "short_text",
  "long_text",
  "email",
  "phone",
  "url",
  "number",
  "single_select",
  "multi_select",
  "dropdown",
  "yes_no",
  "date",
  "time",
  "rating",
  "opinion_scale",
]);

export const MIN_REASON_LENGTH = 3;
export const MAX_REASON_LENGTH = 500;

export function isCorrectable(question: QuestionV1): boolean {
  return CORRECTABLE_TYPES.has(question.type);
}

export type CorrectionResult =
  { ok: true; revisionId: number } | { ok: false; message: string };

const MESSAGES: Record<string, string> = {
  response_not_found: "This response no longer exists.",
  not_submitted: "Only submitted responses can be corrected.",
  confidential: "Answers on confidential forms can't be seen or corrected one by one.",
  reason_required: `Give a reason of at least ${MIN_REASON_LENGTH} characters.`,
  question_not_found: "That question isn't part of the version this response used.",
  not_editable: "This kind of answer can't be corrected.",
  unchanged: "That's the answer already saved.",
};

/** Checks and stores one correction. `admin` is the service-role client:
 * the caller has already checked the person may correct answers here. */
export async function correctAnswer(
  admin: Client,
  input: {
    responseId: string;
    question: QuestionV1;
    value: unknown;
    reason: string;
    actorId: string;
    requestId?: string | null;
  },
): Promise<CorrectionResult> {
  const reason = input.reason.trim();
  if (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH) {
    return { ok: false, message: MESSAGES.reason_required };
  }
  if (!isCorrectable(input.question)) {
    return { ok: false, message: MESSAGES.not_editable };
  }
  const checked = validateAnswer(input.question, input.value);
  if (!checked.ok) return { ok: false, message: checked.message };
  const value = hasAnswer(input.question, input.value)
    ? normalizeAnswer(input.question, input.value)
    : null;

  const { data, error } = await admin.rpc("correct_submitted_answer", {
    p_response_id: input.responseId,
    p_question_id: input.question.id,
    // null clears the answer (the generated type can't say so).
    p_value: value as Json,
    p_reason: reason,
    p_actor: input.actorId,
    p_request_id: input.requestId ?? undefined,
  });
  if (error) {
    const known = Object.keys(MESSAGES).find((code) => error.message.includes(code));
    return {
      ok: false,
      message: known
        ? MESSAGES[known]
        : "Couldn't save the correction. Please try again.",
    };
  }
  return { ok: true, revisionId: Number(data) };
}

export type AnswerRevision = {
  id: number;
  questionId: string;
  previousValue: unknown;
  newValue: unknown;
  reason: string;
  editedBy: string | null;
  editedAt: string;
};

/** A response's corrections, oldest first (read as the viewer). */
export async function listRevisions(
  supabase: Client,
  responseId: string,
): Promise<AnswerRevision[]> {
  const { data } = await supabase
    .from("answer_revisions")
    .select(
      "id, question_id, previous_value, new_value, reason, created_at, profiles(full_name, email)",
    )
    .eq("response_id", responseId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  return (data ?? []).map((row) => {
    const who = row.profiles as { full_name: string | null; email: string | null } | null;
    return {
      id: row.id,
      questionId: row.question_id,
      previousValue: row.previous_value,
      newValue: row.new_value,
      reason: row.reason,
      editedBy: who?.full_name || who?.email || null,
      editedAt: row.created_at,
    };
  });
}
