import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { walkForm, isAnswered, type AnswerMap } from "@/domains/logic";
import type { ResponseStatus } from "./state-machine";

type Client = SupabaseClient<Database>;

export class ResponseNotFoundError extends Error {
  constructor() {
    super("response not found");
    this.name = "ResponseNotFoundError";
  }
}

export class StaleResponseWriteError extends Error {
  constructor() {
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
};

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
  const { data: version, error: versionError } = await admin
    .from("form_versions")
    .select("id")
    .eq("form_id", formId)
    .eq("status", "published")
    .maybeSingle();
  if (versionError) throw versionError;
  if (!version) throw new FormNotAvailableError();

  const { data: response, error } = await admin
    .from("responses")
    .insert({
      form_id: formId,
      form_version_id: version.id,
      referrer: attribution.referrer,
      utm_source: attribution.utmSource,
      utm_medium: attribution.utmMedium,
      utm_campaign: attribution.utmCampaign,
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
  const knownIds = new Set(schema.questions.map((q) => q.id));
  return Object.fromEntries(
    Object.entries(answers).filter(([questionId]) => knownIds.has(questionId)),
  );
}

async function upsertAnswers(
  admin: Client,
  responseId: string,
  answers: AnswerMap,
): Promise<void> {
  const rows = Object.entries(answers)
    .filter(([, value]) => value !== undefined)
    .map(([questionId, value]) => ({
      response_id: responseId,
      question_id: questionId,
      value: value as Json,
      updated_at: new Date().toISOString(),
    }));
  if (rows.length === 0) return;

  const { error } = await admin
    .from("answers")
    .upsert(rows, { onConflict: "response_id,question_id" });
  if (error) throw error;
}

/**
 * Debounced autosave. The UPDATE's WHERE clause — not a separate
 * pre-check — is the actual compare-and-set guard (status not already
 * completed, incoming revision strictly greater than what's stored),
 * so a genuine race between two concurrent writes resolves atomically
 * rather than via a read-then-write gap. The 0-rows-affected path only
 * runs a follow-up read to produce a precise error/short-circuit, not
 * to make the decision.
 */
export async function saveResponseAnswers(
  admin: Client,
  responseId: string,
  expectedRevision: number,
  lastQuestionId: string,
  answers: AnswerMap,
): Promise<{ status: ResponseStatus; revision: number }> {
  const { data: updated, error } = await admin
    .from("responses")
    .update({
      status: "partial",
      client_revision: expectedRevision,
      last_question_id: lastQuestionId,
      last_active_at: new Date().toISOString(),
    })
    .eq("id", responseId)
    .neq("status", "completed")
    .lt("client_revision", expectedRevision)
    .select("status, client_revision, form_version_id")
    .maybeSingle();
  if (error) throw error;

  if (!updated) {
    const { data: current, error: fetchError } = await admin
      .from("responses")
      .select("status, client_revision")
      .eq("id", responseId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!current) throw new ResponseNotFoundError();
    if (current.status === "completed") {
      // A late autosave arriving after the respondent already submitted
      // is a benign race (e.g. a debounced save that was in flight when
      // Enter completed the form) — accept it as a no-op rather than
      // erroring, since nothing about it is actually wrong.
      return { status: "completed", revision: current.client_revision };
    }
    throw new StaleResponseWriteError();
  }

  const { data: versionRow, error: versionError } = await admin
    .from("form_versions")
    .select("schema")
    .eq("id", updated.form_version_id)
    .single();
  if (versionError) throw versionError;
  const schema = parseFormSchema(versionRow.schema);

  await upsertAnswers(admin, responseId, filterAnswersToKnownQuestions(schema, answers));

  return { status: updated.status, revision: updated.client_revision };
}

export type CompleteResult =
  | { ok: true; endingId: string; formId: string; alreadyCompleted: boolean }
  | { ok: false; code: "missing_required"; missingQuestionIds: string[] };

/**
 * Final submission. Idempotent: if the response is already completed
 * (a retried request after a dropped network response, or a race
 * between two tabs), this returns the previously recorded ending
 * without re-validating or re-writing anything — a respondent-facing
 * retry must never surface an error for something that already
 * succeeded.
 *
 * The ending is computed server-side via the same `walkForm` used by
 * the logic engine everywhere else, from the merged answers — never
 * trusted from the client. Required-but-unreached questions (per the
 * actual logic path taken) are correctly excluded from validation.
 */
export async function completeResponse(
  admin: Client,
  responseId: string,
  expectedRevision: number,
  lastQuestionId: string,
  answers: AnswerMap,
  idempotencyKey: string,
): Promise<CompleteResult> {
  const { data: response, error } = await admin
    .from("responses")
    .select("status, form_id, form_version_id, ending_id")
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

  await upsertAnswers(admin, responseId, knownAnswers);

  const walk = walkForm(compiled, knownAnswers);
  const reached = new Set(walk.visitedQuestionIds);
  const missing = compiled.schema.questions.filter(
    (q) => q.required && reached.has(q.id) && !isAnswered(knownAnswers[q.id]),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      code: "missing_required",
      missingQuestionIds: missing.map((q) => q.id),
    };
  }

  const { data: updated, error: updateError } = await admin
    .from("responses")
    .update({
      status: "completed",
      client_revision: expectedRevision,
      last_question_id: lastQuestionId,
      last_active_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      ending_id: walk.endingId,
      idempotency_key: idempotencyKey,
    })
    .eq("id", responseId)
    .neq("status", "completed")
    .select("status")
    .maybeSingle();
  if (updateError) throw updateError;

  if (!updated) {
    // Raced with a concurrent completion of the same response (e.g. two
    // tabs both submitting at once) — the other request won; report its
    // recorded ending rather than erroring.
    const { data: raced, error: racedError } = await admin
      .from("responses")
      .select("ending_id")
      .eq("id", responseId)
      .single();
    if (racedError) throw racedError;
    return {
      ok: true,
      endingId: raced.ending_id ?? walk.endingId,
      formId: response.form_id,
      alreadyCompleted: true,
    };
  }

  return {
    ok: true,
    endingId: walk.endingId,
    formId: response.form_id,
    alreadyCompleted: false,
  };
}
