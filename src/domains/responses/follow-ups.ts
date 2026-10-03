import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { parseFormSchema } from "@/domains/forms/schema";
import { aiConfigured } from "@/domains/ai/config";
import { followUpQuestion } from "@/domains/ai/response-analysis";
import { getWorkspacePlan, spendAiCredit } from "@/domains/billing";

type Client = SupabaseClient<Database>;

/**
 * Adaptive follow-ups (PRD P3.7). When the creator switches it on for a
 * long-text question, the respondent may get one AI-written follow-up
 * about what they wrote. It is always optional and never blocks the
 * form: anything that goes wrong here means "no follow-up". The question
 * and its answer live in `response_followups`, beside the response —
 * the form's own answers, validation and logic are untouched.
 *
 * Whether a question allows follow-ups is read from the version the
 * response was served, never from the browser. Each follow-up costs the
 * workspace one AI credit; out of credits means none are asked.
 */

/** Follow-ups one response can be asked in total. */
export const MAX_FOLLOW_UPS_PER_RESPONSE = 3;

export async function askFollowUp(
  admin: Client,
  responseId: string,
  questionId: string,
  answer: string,
): Promise<string | null> {
  if (!aiConfigured()) return null;
  const { data: response } = await admin
    .from("responses")
    .select("id, status, form_version_id, forms!inner(workspace_id, title)")
    .eq("id", responseId)
    .maybeSingle();
  if (!response || response.status === "completed") return null;

  const { data: existing } = await admin
    .from("response_followups")
    .select("question_id, prompt, answer")
    .eq("response_id", responseId);
  const already = existing?.find((f) => f.question_id === questionId);
  // Asked before (a refresh, a retry): the same question, not a new one.
  if (already) return already.answer === null ? already.prompt : null;
  if ((existing?.length ?? 0) >= MAX_FOLLOW_UPS_PER_RESPONSE) return null;

  const { data: version } = await admin
    .from("form_versions")
    .select("schema")
    .eq("id", response.form_version_id)
    .single();
  if (!version) return null;
  const schema = parseFormSchema(version.schema);
  const question = schema.questions.find((q) => q.id === questionId);
  if (!question || question.type !== "long_text" || !question.settings.aiFollowUp)
    return null;

  const form = response.forms as { workspace_id: string; title: string };
  const { entitlements } = await getWorkspacePlan(admin, form.workspace_id);
  if (!(await spendAiCredit(admin, form.workspace_id, entitlements))) return null;

  const prompt = await followUpQuestion({
    formTitle: schema.meta.title,
    questionLabel: question.label,
    answer,
  });
  if (!prompt) return null;
  const { error } = await admin
    .from("response_followups")
    .insert({ response_id: responseId, question_id: questionId, prompt });
  // Two requests raced: use the one that was stored.
  if (error) {
    const { data: stored } = await admin
      .from("response_followups")
      .select("prompt")
      .eq("response_id", responseId)
      .eq("question_id", questionId)
      .maybeSingle();
    return stored?.prompt ?? null;
  }
  return prompt;
}

/** Saves the respondent's reply to a follow-up that was really asked.
 * Editable until the response is submitted; after that, only a reply
 * that hadn't arrived yet is accepted. */
export async function replyToFollowUp(
  admin: Client,
  responseId: string,
  questionId: string,
  text: string,
): Promise<boolean> {
  const { data: row } = await admin
    .from("response_followups")
    .select("id, answer, responses!inner(status)")
    .eq("response_id", responseId)
    .eq("question_id", questionId)
    .maybeSingle();
  if (!row) return false;
  const completed = (row.responses as { status: string }).status === "completed";
  if (completed && row.answer !== null) return false;
  const { error } = await admin
    .from("response_followups")
    .update({ answer: text, answered_at: new Date().toISOString() })
    .eq("id", row.id);
  return !error;
}
