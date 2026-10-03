import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { parseFormSchema } from "@/domains/forms/schema";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { deleteResponse } from "./dashboard";
import { formatAnswerValue } from "./format";

type Client = SupabaseClient<Database>;

/**
 * Privacy requests (PRD P3.17): when someone asks what a workspace holds
 * about them, or asks for it to be erased, an admin looks them up by
 * email. A response counts when an answer is exactly that address (an
 * email question, or a text question used for one) or a contact step
 * has it. Reads go through RLS; deleting reuses the
 * ordinary response delete (which also removes uploaded files).
 */

export type PersonResponse = {
  responseId: string;
  formId: string;
  formTitle: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
};

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function findPersonResponses(
  supabase: Client,
  workspaceId: string,
  email: string,
): Promise<PersonResponse[]> {
  const { data, error } = await supabase.rpc("responses_by_email", {
    p_workspace_id: workspaceId,
    p_email: email,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    responseId: r.response_id,
    formId: r.form_id,
    formTitle: r.form_title,
    status: r.status,
    startedAt: r.started_at,
    completedAt: r.completed_at,
  }));
}

export type PersonExport = {
  email: string;
  exportedAt: string;
  responses: {
    form: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    language: string | null;
    source: { referrer: string | null; utmSource: string | null };
    answers: { question: string; answer: string }[];
    followUps: { question: string; answer: string | null }[];
    files: string[];
    payment: { amount: number; currency: string; status: string } | null;
  }[];
};

/** Everything held about that person, in a form they can be given. */
export async function exportPersonData(
  supabase: Client,
  workspaceId: string,
  email: string,
): Promise<PersonExport> {
  const found = await findPersonResponses(supabase, workspaceId, email);
  const titles = new Map(found.map((f) => [f.responseId, f.formTitle]));
  const ids = found.map((f) => f.responseId);
  const responses: PersonExport["responses"] = [];
  const schemas = new Map<string, FormSchemaV1 | null>();

  for (let i = 0; i < ids.length; i += 50) {
    const { data, error } = await supabase
      .from("responses")
      .select(
        "id, status, started_at, completed_at, language, referrer, utm_source, form_version_id, answers(question_id, value), response_followups(prompt, answer), uploads(original_filename), payments(amount, currency, status)",
      )
      .in("id", ids.slice(i, i + 50));
    if (error) throw error;
    for (const r of data ?? []) {
      if (!schemas.has(r.form_version_id)) {
        const { data: version } = await supabase
          .from("form_versions")
          .select("schema")
          .eq("id", r.form_version_id)
          .maybeSingle();
        let parsed: FormSchemaV1 | null = null;
        try {
          parsed = version ? parseFormSchema(version.schema) : null;
        } catch {
          parsed = null;
        }
        schemas.set(r.form_version_id, parsed);
      }
      const schema = schemas.get(r.form_version_id);
      const uploadNames = new Map<string, string>();
      const payment = Array.isArray(r.payments) ? r.payments[0] : r.payments;
      responses.push({
        form: titles.get(r.id) ?? "",
        status: r.status,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        language: r.language,
        source: { referrer: r.referrer, utmSource: r.utm_source },
        answers: (r.answers ?? []).map((a) => {
          const question = schema?.questions.find((q) => q.id === a.question_id);
          return {
            question: question?.label || a.question_id,
            answer: question
              ? formatAnswerValue(question, a.value, { uploadNames })
              : JSON.stringify(a.value),
          };
        }),
        followUps: (r.response_followups ?? []).map((f) => ({
          question: f.prompt,
          answer: f.answer,
        })),
        files: (r.uploads ?? []).map((u) => u.original_filename),
        payment: payment
          ? { amount: payment.amount, currency: payment.currency, status: payment.status }
          : null,
      });
    }
  }
  return { email, exportedAt: new Date().toISOString(), responses };
}

/** Erases every response carrying that email (and its files). Returns
 * how many were deleted; ones the caller may not delete are left. */
export async function deletePersonData(
  supabase: Client,
  admin: Client,
  workspaceId: string,
  email: string,
): Promise<{ found: number; deleted: number }> {
  let found = 0;
  let deleted = 0;
  // The lookup returns at most 500 at a time; keep going until none are left.
  for (let round = 0; round < 20; round += 1) {
    const batch = await findPersonResponses(supabase, workspaceId, email);
    if (batch.length === 0) break;
    found += batch.length;
    let removed = 0;
    for (const r of batch) {
      if (await deleteResponse(supabase, r.responseId, admin)) removed += 1;
    }
    deleted += removed;
    if (removed === 0) break;
  }
  return { found, deleted };
}
