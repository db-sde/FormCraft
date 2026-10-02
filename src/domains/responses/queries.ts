import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";
import { SEED_PATTERN } from "@/domains/logic/random";
import { answerUsesAvailableOptions } from "@/domains/forms/options";
import {
  walkForm,
  validateAnswer,
  hasAnswer,
  isAnswered,
  type AnswerMap,
} from "@/domains/logic";
import type { ResponseStatus } from "./state-machine";

type Client = SupabaseClient<Database>;

export class ResponseNotFoundError extends Error {
  constructor() {
    super("response not found");
    this.name = "ResponseNotFoundError";
  }
}

export class StaleResponseWriteError extends Error {
  constructor(
    /** The revision the server already holds, so the client can resync
     * to it instead of abandoning the respondent's session. */
    public readonly currentRevision: number,
  ) {
    super("a newer answer for this response was already saved");
    this.name = "StaleResponseWriteError";
  }
}

export class FormNotAvailableError extends Error {
  constructor() {
    super("this form is not currently accepting responses");
    this.name = "FormNotAvailableError";
  }
}

export type StartAttribution = {
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  /** Came through an embed on another site. */
  embedded?: boolean;
  /** Values for the form's declared hidden fields, from its URL. */
  hidden?: Record<string, string>;
  /** The browser's random seed for pools and option order. */
  seed?: string;
  /** The language the respondent chose (P2.21). */
  language?: string;
};

/** Only the hidden fields the published form declares, as short strings —
 * anything else the client sends is dropped. */
export function pickHiddenFields(
  schema: FormSchemaV1,
  provided: Record<string, unknown> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!provided) return out;
  for (const field of schema.hiddenFields ?? []) {
    const value = provided[field.name];
    if (typeof value === "string" && value !== "") out[field.name] = value.slice(0, 500);
  }
  return out;
}

function storedHidden(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
}

/**
 * Creates the IN_PROGRESS response row for a fresh respondent session.
 * Always resolves the form's *currently published* version — never a
 * client-supplied version id — so a form that gets unpublished or
 * republished mid-session can't be spoofed into a different one.
 */
export async function startResponse(
  admin: Client,
  formId: string,
  attribution: StartAttribution = {},
): Promise<{ responseId: string; formVersionId: string }> {
  // This runs with the admin client (no RLS), so the "form isn't
  // deleted" rule the public read policies enforce has to be checked
  // explicitly here too.
  const { data: form, error: formError } = await admin
    .from("forms")
    .select("id")
    .eq("id", formId)
    .is("deleted_at", null)
    .maybeSingle();
  if (formError) throw formError;
  if (!form) throw new FormNotAvailableError();

  const { data: version, error: versionError } = await admin
    .from("form_versions")
    .select("id, schema")
    .eq("form_id", formId)
    .eq("status", "published")
    .maybeSingle();
  if (versionError) throw versionError;
  if (!version) throw new FormNotAvailableError();
  const hidden = attribution.hidden
    ? pickHiddenFields(parseFormSchema(version.schema), attribution.hidden)
    : {};

  const { data: response, error } = await admin
    .from("responses")
    .insert({
      form_id: formId,
      form_version_id: version.id,
      referrer: attribution.referrer,
      utm_source: attribution.utmSource,
      utm_medium: attribution.utmMedium,
      utm_campaign: attribution.utmCampaign,
      utm_term: attribution.utmTerm,
      utm_content: attribution.utmContent,
      embedded: attribution.embedded ?? false,
      hidden_fields: hidden,
      random_seed:
        attribution.seed && SEED_PATTERN.test(attribution.seed) ? attribution.seed : null,
      language:
        attribution.language && /^[a-z]{2}$/.test(attribution.language)
          ? attribution.language
          : null,
    })
    .select("id, form_version_id")
    .single();
  if (error) throw error;

  return { responseId: response.id, formVersionId: response.form_version_id };
}

/**
 * The server is authoritative over what a response's schema actually
 * is (CLAUDE.md rule 1) — a respondent's client only ever sends
 * `{ [questionId]: value }`, and nothing stops a forged request from
 * naming a questionId that was never part of this form's published
 * schema. Silently dropping unknown keys here (rather than trusting
 * the client's shape once it passes Zod) is what keeps `answers` from
 * accumulating arbitrary attacker-chosen rows tied to a real
 * response_id — a real, if modest, storage-abuse vector found via
 * live adversarial testing, not by code review.
 */
function filterAnswersToKnownQuestions(
  schema: FormSchemaV1,
  answers: AnswerMap,
): AnswerMap {
  const byId = new Map(schema.questions.map((q) => [q.id, q]));
  const known: AnswerMap = {};
  for (const [questionId, value] of Object.entries(answers)) {
    const question = byId.get(questionId);
    if (question) known[questionId] = normalizeAnswer(question, value);
  }
  return known;
}

/**
 * Shapes an answer into what is stored. A Contact info answer keeps only
 * the fields the block asks for, trimmed, with blank ones dropped — so a
 * block the respondent emptied (or filled with spaces) becomes `{}`,
 * which the database removes, instead of lingering as a "lead" with no
 * details.
 */
export function normalizeAnswer(question: QuestionV1, value: unknown): unknown {
  if (question.type !== "contact_info") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const kept: Record<string, string> = {};
  for (const field of question.settings.fields) {
    const raw = record[field];
    if (typeof raw === "string" && raw.trim() !== "") kept[field] = raw.trim();
  }
  // Fields outside the block's configuration are left for validation
  // to reject rather than silently discarded here.
  const unexpected = Object.keys(record).some(
    (key) => !(question.settings.fields as string[]).includes(key),
  );
  return unexpected ? value : kept;
}

/** Only defined values, as plain JSON for the database functions. */
function toAnswersJson(answers: AnswerMap): Json {
  return Object.fromEntries(
    Object.entries(answers).filter(([, value]) => value !== undefined),
  ) as Json;
}

/**
 * Debounced autosave — one database transaction (save_response_progress)
 * that locks the response row, rejects a revision that isn't newer, and
 * writes the revision and the answers together. Concurrent saves are
 * therefore serialised: the stored answers always belong to the stored
 * revision (they used to be separate statements, so an older answer
 * could end up under a newer revision).
 *
 * Whether the save contains a real answer decides the status: only a
 * response with at least one answer is "partial"; one that has only
 * moved past the welcome screen stays in_progress. A form whose creator
 * turned off saving unfinished answers stores nothing (enforced inside
 * the function, not just by the runtime not sending them).
 */
export async function saveResponseAnswers(
  admin: Client,
  responseId: string,
  expectedRevision: number,
  lastQuestionId: string,
  answers: AnswerMap,
): Promise<{ status: ResponseStatus; revision: number }> {
  const { data: response, error: responseError } = await admin
    .from("responses")
    .select("form_version_id")
    .eq("id", responseId)
    .maybeSingle();
  if (responseError) throw responseError;
  if (!response) throw new ResponseNotFoundError();

  const { data: versionRow, error: versionError } = await admin
    .from("form_versions")
    .select("schema")
    .eq("id", response.form_version_id)
    .single();
  if (versionError) throw versionError;
  const known = filterAnswersToKnownQuestions(
    parseFormSchema(versionRow.schema),
    answers,
  );

  const { data, error } = await admin.rpc("save_response_progress", {
    p_response_id: responseId,
    p_revision: expectedRevision,
    p_last_question_id: lastQuestionId,
    p_answers: toAnswersJson(known),
    p_has_answer: Object.values(known).some(isAnswered),
  });
  if (error) throw error;

  const result = data?.[0];
  if (!result || result.outcome === "not_found") throw new ResponseNotFoundError();
  if (result.outcome === "stale") {
    throw new StaleResponseWriteError(Number(result.client_revision));
  }
  // "ok" or "completed" (a late autosave after submit is a harmless no-op).
  return {
    status: result.status as ResponseStatus,
    revision: Number(result.client_revision),
  };
}

export type CompleteResult =
  | { ok: true; endingId: string; formId: string; alreadyCompleted: boolean }
  | {
      ok: false;
      code: "missing_required" | "invalid_answer";
      /** Every question that failed, required or otherwise — in form order. */
      missingQuestionIds: string[];
      errors: { questionId: string; message: string }[];
    };

/**
 * Final submission. Idempotent: if the response is already completed
 * (a retried request after a dropped network response, or a race
 * between two tabs), this returns the previously recorded ending
 * without re-validating or re-writing anything — a respondent-facing
 * retry must never surface an error for something that already
 * succeeded.
 *
 * Validation happens first and writes nothing: a rejected submission
 * leaves no trace of its answers (they used to be saved before being
 * checked, including on forms that opted out of keeping unfinished
 * answers). Only then does one database transaction
 * (complete_response_atomic) store the answers on the path actually
 * taken, discard ones left on abandoned branches, and mark the response
 * completed.
 *
 * The ending is computed server-side via the same `walkForm` used by
 * the logic engine everywhere else — never trusted from the client.
 * Required-but-unreached questions are correctly excluded.
 */
export async function completeResponse(
  admin: Client,
  responseId: string,
  expectedRevision: number,
  lastQuestionId: string,
  answers: AnswerMap,
  idempotencyKey: string,
  options: { spamSuspected?: boolean } = {},
): Promise<CompleteResult> {
  const { data: response, error } = await admin
    .from("responses")
    .select("status, form_id, form_version_id, ending_id, hidden_fields, random_seed")
    .eq("id", responseId)
    .maybeSingle();
  if (error) throw error;
  if (!response) throw new ResponseNotFoundError();

  if (response.status === "completed") {
    return {
      ok: true,
      endingId: response.ending_id ?? "",
      formId: response.form_id,
      alreadyCompleted: true,
    };
  }

  const { data: versionRow, error: versionError } = await admin
    .from("form_versions")
    .select("schema")
    .eq("id", response.form_version_id)
    .single();
  if (versionError) throw versionError;
  const compiled = compileFormSchema(parseFormSchema(versionRow.schema));
  const knownAnswers = filterAnswersToKnownQuestions(compiled.schema, answers);

  const walk = walkForm(compiled, knownAnswers, {
    hidden: storedHidden(response.hidden_fields),
    now: new Date(),
    seed: response.random_seed ?? undefined,
  });
  const reached = new Set(walk.visitedQuestionIds);
  // Only questions on the path actually taken are validated: an answer
  // left behind on a branch the respondent later logic-jumped away
  // from is irrelevant to this submission.
  const pathQuestions = compiled.schema.questions.filter((q) => reached.has(q.id));
  const errors = pathQuestions.flatMap((q) => {
    const result = validateAnswer(q, knownAnswers[q.id]);
    if (!result.ok) return [{ questionId: q.id, message: result.message }];
    // Carried-forward options: only the ones this respondent was offered.
    if (!answerUsesAvailableOptions(q, knownAnswers[q.id], knownAnswers)) {
      return [{ questionId: q.id, message: "Choose one of the options shown." }];
    }
    return [];
  });
  // The form's own conditional / cross-field checks, on the path taken.
  for (const failure of walk.validationErrors) {
    if (!errors.some((e) => e.questionId === failure.questionId)) errors.push(failure);
  }

  // A file answer is an upload id; it must be a real upload of *this*
  // response for *this* question, not any string the client sent.
  const fileQuestions = pathQuestions.filter(
    (q) => q.type === "file_upload" && hasAnswer(q, knownAnswers[q.id]),
  );
  if (fileQuestions.length > 0) {
    const { data: uploads, error: uploadsError } = await admin
      .from("uploads")
      .select("id, question_id, status")
      .eq("response_id", responseId);
    if (uploadsError) throw uploadsError;
    for (const q of fileQuestions) {
      const value = knownAnswers[q.id];
      const valid = (uploads ?? []).some(
        (u) =>
          u.id === value &&
          u.question_id === q.id &&
          u.status !== "quarantined" &&
          u.status !== "deleted",
      );
      if (!valid && !errors.some((e) => e.questionId === q.id)) {
        errors.push({
          questionId: q.id,
          message: "That file isn't available — upload it again.",
        });
      }
    }
  }

  if (errors.length > 0) {
    const onlyMissing = errors.every((e) => {
      const q = compiled.schema.questions.find((x) => x.id === e.questionId);
      return q !== undefined && !hasAnswer(q, knownAnswers[q.id]);
    });
    return {
      ok: false,
      code: onlyMissing ? "missing_required" : "invalid_answer",
      missingQuestionIds: errors.map((e) => e.questionId),
      errors,
    };
  }

  const pathAnswers = Object.fromEntries(
    Object.entries(knownAnswers).filter(([questionId]) => reached.has(questionId)),
  );
  const { data, error: completeError } = await admin.rpc("complete_response_atomic", {
    p_response_id: responseId,
    p_revision: expectedRevision,
    p_last_question_id: lastQuestionId,
    p_answers: toAnswersJson(pathAnswers),
    p_ending_id: walk.endingId,
    p_idempotency_key: idempotencyKey,
    p_spam: options.spamSuspected ?? false,
  });
  if (completeError) throw completeError;

  const result = data?.[0];
  if (!result || result.outcome === "not_found") throw new ResponseNotFoundError();
  return {
    ok: true,
    endingId: result.ending_id ?? walk.endingId,
    formId: result.form_id ?? response.form_id,
    // "already": another request completed it first; its ending stands.
    alreadyCompleted: result.outcome === "already",
  };
}
