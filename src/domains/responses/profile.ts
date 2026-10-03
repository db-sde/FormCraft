import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";
import { hasAnswer, validateAnswer } from "@/domains/logic/validate-answer";

type Client = SupabaseClient<Database>;

/**
 * Progressive profiling (logic spec phase 23). A question with a
 * `profileKey` ("ask once per person") is skipped for a visitor who has
 * already answered a question with the same key, on any form in the
 * workspace. The remembered answer is filled in for them, so each
 * response is still complete on its own and the server's walk needs no
 * special case.
 *
 * The visitor is the random first-party cookie the proxy sets on form
 * pages — a browser, not a person. On a shared device the next person
 * can choose "answer them again"; remembered answers are never shown.
 */

/** Question types whose answer means the same on any form. Choice
 * questions aren't included: their option ids belong to one form. */
export const PROFILE_QUESTION_TYPES = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "url",
  "number",
  "date",
  "yes_no",
  "contact_info",
] as const satisfies readonly QuestionV1["type"][];

export const PROFILE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
/** Remembered answers not refreshed for this long are deleted. */
export const PROFILE_RETENTION_DAYS = 395;

export function isProfileQuestion(question: QuestionV1): boolean {
  return (
    !!question.profileKey &&
    (PROFILE_QUESTION_TYPES as readonly string[]).includes(question.type)
  );
}

export function usesProfiles(schema: Pick<FormSchemaV1, "questions">): boolean {
  return schema.questions.some(isProfileQuestion);
}

/** A suggested key from a question's label ("Company name" → company_name). */
export function profileKeyFromLabel(label: string): string {
  const key = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  return PROFILE_KEY_PATTERN.test(key) ? key : "detail";
}

/** What this visitor has already told the workspace, as answers to this
 * form's "ask once" questions (by question id). Only values that are
 * valid answers to the question as it is now are reused. */
export async function knownAnswersFor(
  admin: Client,
  workspaceId: string,
  visitorId: string,
  schema: FormSchemaV1,
): Promise<Record<string, unknown>> {
  const profileQuestions = schema.questions.filter(isProfileQuestion);
  if (profileQuestions.length === 0) return {};
  const { data } = await admin
    .from("visitor_profiles")
    .select("key, value, question_type")
    .eq("workspace_id", workspaceId)
    .eq("visitor_id", visitorId)
    .in("key", [...new Set(profileQuestions.map((q) => q.profileKey!))]);
  const known: Record<string, unknown> = {};
  for (const question of profileQuestions) {
    const row = data?.find(
      (r) => r.key === question.profileKey && r.question_type === question.type,
    );
    if (!row || !hasAnswer(question, row.value)) continue;
    if (validateAnswer(question, row.value).ok) known[question.id] = row.value;
  }
  return known;
}

/** After a submission: remembers the answers to its "ask once"
 * questions for that visitor. */
export async function rememberProfile(
  admin: Client,
  responseId: string,
): Promise<number> {
  const { data: response } = await admin
    .from("responses")
    .select(
      "visitor_id, status, forms!inner(workspace_id), form_versions!inner(schema), answers(question_id, value)",
    )
    .eq("id", responseId)
    .maybeSingle();
  if (!response?.visitor_id || response.status !== "completed") return 0;
  const schema = (response.form_versions as { schema: unknown }).schema as FormSchemaV1;
  const workspaceId = (response.forms as { workspace_id: string }).workspace_id;
  const rows = (schema.questions ?? []).flatMap((question) => {
    if (!isProfileQuestion(question)) return [];
    const answer = response.answers.find((a) => a.question_id === question.id);
    if (!answer || !hasAnswer(question, answer.value)) return [];
    return [
      {
        workspace_id: workspaceId,
        visitor_id: response.visitor_id!,
        key: question.profileKey!,
        value: answer.value as Json,
        question_type: question.type,
        updated_at: new Date().toISOString(),
      },
    ];
  });
  if (rows.length === 0) return 0;
  const { error } = await admin.from("visitor_profiles").upsert(rows);
  if (error) throw error;
  return rows.length;
}

/** Forgets what these visitors told the workspace (privacy requests). */
export async function forgetVisitors(
  admin: Client,
  workspaceId: string,
  visitorIds: string[],
): Promise<void> {
  const ids = [...new Set(visitorIds)].filter(Boolean);
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await admin
      .from("visitor_profiles")
      .delete()
      .eq("workspace_id", workspaceId)
      .in("visitor_id", ids.slice(i, i + 100));
    if (error) throw error;
  }
}

/** Retention: remembered answers nobody has refreshed in over a year. */
export async function purgeStaleProfiles(
  admin: Client,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - PROFILE_RETENTION_DAYS * 86_400_000,
  ).toISOString();
  const { data, error } = await admin
    .from("visitor_profiles")
    .delete()
    .lt("updated_at", cutoff)
    .select("key");
  if (error) throw error;
  return data?.length ?? 0;
}
