import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { parseFormSchema } from "@/domains/forms/schema";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { spendAiCredit, type Entitlements } from "@/domains/billing";
import {
  analyzeResponse,
  describeResponseForAi,
  summarizeResponses,
  type ResponseSummaryAi,
} from "@/domains/ai/response-analysis";

type Client = SupabaseClient<Database>;

/**
 * Stored AI analysis of responses (Phase 3, Wave B). Runs with the
 * service role after the caller's checks; reads go through RLS
 * (`view_responses`). Each response analysed and each summary costs one
 * AI credit, spent before the call.
 */

export type ResponseInsight = {
  responseId: string;
  sentiment: "positive" | "neutral" | "negative" | "mixed" | null;
  tags: string[];
  leadScore: number | null;
  leadReason: string | null;
};

/** At most this many responses per "Analyze" click. */
export const ANALYZE_BATCH = 20;
/** Responses read for a summary (newest first). */
export const SUMMARY_RESPONSES = 200;

type Loaded = {
  id: string;
  formVersionId: string;
  answers: Record<string, unknown>;
  followUps: { questionId: string; prompt: string; answer: string | null }[];
};

async function loadResponses(
  admin: Client,
  formId: string,
  ids: string[],
): Promise<Loaded[]> {
  if (ids.length === 0) return [];
  const { data, error } = await admin
    .from("responses")
    .select(
      "id, form_version_id, answers(question_id, value), response_followups(question_id, prompt, answer)",
    )
    .eq("form_id", formId)
    .eq("status", "completed")
    .in("id", ids);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    formVersionId: r.form_version_id,
    answers: Object.fromEntries((r.answers ?? []).map((a) => [a.question_id, a.value])),
    followUps: (r.response_followups ?? []).map((f) => ({
      questionId: f.question_id,
      prompt: f.prompt,
      answer: f.answer,
    })),
  }));
}

/** Each response is described with the version it was served. */
async function schemasFor(admin: Client, versionIds: string[]) {
  const unique = [...new Set(versionIds)];
  const { data, error } = await admin
    .from("form_versions")
    .select("id, schema")
    .in("id", unique);
  if (error) throw error;
  const map = new Map<string, FormSchemaV1>();
  for (const v of data ?? []) {
    try {
      map.set(v.id, parseFormSchema(v.schema));
    } catch {
      // A version that no longer parses is skipped.
    }
  }
  return map;
}

/** Completed responses on this form with no analysis yet, newest first. */
export async function unanalyzedResponseIds(
  admin: Client,
  formId: string,
  limit = ANALYZE_BATCH,
): Promise<string[]> {
  const { data, error } = await admin
    .from("responses")
    .select("id, response_insights(response_id)")
    .eq("form_id", formId)
    .eq("status", "completed")
    .eq("spam_suspected", false)
    .order("completed_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? [])
    .filter((r) => !r.response_insights)
    .slice(0, limit)
    .map((r) => r.id);
}

/** Analyses the given responses (re-analysing replaces). Stops when the
 * plan's AI credits run out. */
export async function analyzeResponses(
  admin: Client,
  input: {
    formId: string;
    workspaceId: string;
    responseIds: string[];
    entitlements: Entitlements;
  },
): Promise<{ analyzed: number; outOfCredits: boolean; failed: number }> {
  const { data: form } = await admin
    .from("forms")
    .select("ai_lead_criteria")
    .eq("id", input.formId)
    .single();
  const responses = await loadResponses(
    admin,
    input.formId,
    input.responseIds.slice(0, ANALYZE_BATCH),
  );
  const schemas = await schemasFor(
    admin,
    responses.map((r) => r.formVersionId),
  );
  const { data: existing } = await admin
    .from("response_insights")
    .select("tags")
    .eq("form_id", input.formId)
    .limit(500);
  const tagCounts = new Map<string, number>();
  for (const row of existing ?? [])
    for (const t of row.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const knownTags = () =>
    [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);

  let analyzed = 0;
  let failed = 0;
  // One at a time: tags from earlier responses are reused by later ones.
  for (const response of responses) {
    const schema = schemas.get(response.formVersionId);
    if (!schema) {
      failed += 1;
      continue;
    }
    if (!(await spendAiCredit(admin, input.workspaceId, input.entitlements))) {
      return { analyzed, outOfCredits: true, failed };
    }
    const result = await analyzeResponse({
      schema,
      answers: response.answers,
      followUps: response.followUps,
      leadCriteria: form?.ai_lead_criteria ?? null,
      knownTags: knownTags(),
    });
    if (!result) {
      failed += 1;
      continue;
    }
    const { error } = await admin.from("response_insights").upsert({
      response_id: response.id,
      form_id: input.formId,
      sentiment: result.sentiment,
      tags: result.tags,
      lead_score: result.leadScore,
      lead_reason: result.leadReason,
      analyzed_at: new Date().toISOString(),
    });
    if (error) throw error;
    for (const t of result.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    analyzed += 1;
  }
  return { analyzed, outOfCredits: false, failed };
}

export async function insightsFor(
  supabase: Client,
  responseIds: string[],
): Promise<Map<string, ResponseInsight>> {
  if (responseIds.length === 0) return new Map();
  const { data } = await supabase
    .from("response_insights")
    .select("response_id, sentiment, tags, lead_score, lead_reason")
    .in("response_id", responseIds);
  return new Map(
    (data ?? []).map((r) => [
      r.response_id,
      {
        responseId: r.response_id,
        sentiment: r.sentiment as ResponseInsight["sentiment"],
        tags: r.tags,
        leadScore: r.lead_score,
        leadReason: r.lead_reason,
      },
    ]),
  );
}

export type InsightTotals = {
  analyzed: number;
  sentiment: Record<"positive" | "neutral" | "negative" | "mixed", number>;
  topTags: { tag: string; count: number }[];
  averageLeadScore: number | null;
};

/** Counts across a form's analysed responses, for the Summary tab. */
export async function insightTotals(
  supabase: Client,
  formId: string,
): Promise<InsightTotals> {
  const { data } = await supabase
    .from("response_insights")
    .select("sentiment, tags, lead_score")
    .eq("form_id", formId)
    .limit(5000);
  const rows = data ?? [];
  const sentiment = { positive: 0, neutral: 0, negative: 0, mixed: 0 };
  const tags = new Map<string, number>();
  let scoreSum = 0;
  let scored = 0;
  for (const r of rows) {
    if (r.sentiment && r.sentiment in sentiment)
      sentiment[r.sentiment as keyof typeof sentiment] += 1;
    for (const t of r.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
    if (typeof r.lead_score === "number") {
      scoreSum += r.lead_score;
      scored += 1;
    }
  }
  return {
    analyzed: rows.length,
    sentiment,
    topTags: [...tags.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count })),
    averageLeadScore: scored ? Math.round(scoreSum / scored) : null,
  };
}

export type StoredSummary = {
  summary: ResponseSummaryAi;
  responseCount: number;
  generatedAt: string;
};

export async function getFormSummary(
  supabase: Client,
  formId: string,
): Promise<StoredSummary | null> {
  const { data } = await supabase
    .from("form_ai_summaries")
    .select("summary, response_count, generated_at")
    .eq("form_id", formId)
    .maybeSingle();
  return data
    ? {
        summary: data.summary as ResponseSummaryAi,
        responseCount: data.response_count,
        generatedAt: data.generated_at,
      }
    : null;
}

/** Summarises the newest completed responses and stores it (one credit). */
export async function generateFormSummary(
  admin: Client,
  input: {
    formId: string;
    workspaceId: string;
    userId: string;
    entitlements: Entitlements;
  },
): Promise<"ok" | "no_responses" | "out_of_credits" | "failed"> {
  const { data: rows, error } = await admin
    .from("responses")
    .select("id")
    .eq("form_id", input.formId)
    .eq("status", "completed")
    .eq("spam_suspected", false)
    .order("completed_at", { ascending: false })
    .limit(SUMMARY_RESPONSES);
  if (error) throw error;
  const responses: Loaded[] = [];
  const ids = (rows ?? []).map((r) => r.id);
  for (let i = 0; i < ids.length; i += 100)
    responses.push(...(await loadResponses(admin, input.formId, ids.slice(i, i + 100))));
  const schemas = await schemasFor(
    admin,
    responses.map((r) => r.formVersionId),
  );
  const transcripts = responses
    .map((r) => {
      const schema = schemas.get(r.formVersionId);
      return schema ? describeResponseForAi(schema, r.answers, r.followUps) : "";
    })
    .filter(Boolean);
  if (transcripts.length === 0) return "no_responses";
  const latest = schemas.get(responses[0].formVersionId)!;
  if (!(await spendAiCredit(admin, input.workspaceId, input.entitlements)))
    return "out_of_credits";
  const result = await summarizeResponses({ schema: latest, transcripts });
  if (!result) return "failed";
  const { error: saveError } = await admin.from("form_ai_summaries").upsert({
    form_id: input.formId,
    summary: result.summary as unknown as Json,
    response_count: result.used,
    generated_by: input.userId,
    generated_at: new Date().toISOString(),
  });
  if (saveError) throw saveError;
  return "ok";
}
