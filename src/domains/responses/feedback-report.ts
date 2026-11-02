import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";
import { parseFormSchema } from "@/domains/forms/schema";
import { hasAnswer } from "@/domains/logic/validate-answer";

type Client = SupabaseClient<Database>;

/**
 * Confidential feedback, e.g. 360 reviews (master spec F-30). Product
 * owner's rules (2026-10-31): nobody sees individual ratings — only
 * averages — and a group of raters smaller than the threshold (3 by
 * default) is never shown on its own. The database hides a confidential
 * form's individual responses from every signed-in user; this report is
 * computed on the server, after the caller's permission is checked.
 *
 * - Rater groups come from one choice question ("Your relationship to
 *   the person"). Groups under the threshold are pooled into "Others";
 *   if that pool is still under it, it joins the smallest shown group,
 *   so no figure can be subtracted out of the overall.
 * - Nothing is shown at all until the form has at least the threshold.
 * - Comments are listed together, in an order that says nothing about
 *   who wrote them, with no group, time or other detail.
 */

export const DEFAULT_THRESHOLD = 3;

export const ConfidentialSettings = z.object({
  threshold: z.number().int().min(2).max(50),
  groupQuestionId: z.string().max(64).optional(),
});
export type ConfidentialSettings = z.infer<typeof ConfidentialSettings>;

export function readConfidential(raw: unknown): ConfidentialSettings | null {
  const parsed = ConfidentialSettings.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const SCORED = new Set(["rating", "opinion_scale", "number"]);
const COMMENTS = new Set(["long_text", "short_text"]);

export type FeedbackReport = {
  threshold: number;
  responses: number;
  /** False until there are at least `threshold` responses. */
  shown: boolean;
  groups: { label: string; responses: number }[];
  /** Responses in groups too small to show (still in the overall). */
  hiddenResponses: number;
  scores: {
    questionId: string;
    label: string;
    scale: string;
    overall: number | null;
    byGroup: (number | null)[];
  }[];
  choices: {
    questionId: string;
    label: string;
    bars: { label: string; percent: number }[];
  }[];
  comments: { questionId: string; label: string; texts: string[] }[];
};

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

/** An order for comments that doesn't follow submission order. */
function scramble(texts: string[]): string[] {
  const key = (s: string) => {
    let h = 2166136261;
    for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0;
    return h;
  };
  return [...texts].sort((a, b) => key(a) - key(b) || a.localeCompare(b));
}

function scaleOf(q: QuestionV1): string {
  if (q.type === "rating") return `1–${q.settings.scale}`;
  if (q.type === "opinion_scale") return `${q.settings.min}–${q.settings.max}`;
  return "number";
}

/** The report for answers already loaded (pure). */
export function buildFeedbackReport(
  schema: FormSchemaV1,
  settings: ConfidentialSettings,
  answers: Map<string, unknown>[],
): FeedbackReport {
  const threshold = settings.threshold;
  const empty: FeedbackReport = {
    threshold,
    responses: answers.length,
    shown: false,
    groups: [],
    hiddenResponses: 0,
    scores: [],
    choices: [],
    comments: [],
  };
  if (answers.length < threshold) return empty;

  const questions = [...schema.questions].sort((a, b) => a.order - b.order);
  const groupQuestion = questions.find(
    (q) =>
      q.id === settings.groupQuestionId &&
      (q.type === "single_select" || q.type === "dropdown"),
  ) as Extract<QuestionV1, { type: "single_select" | "dropdown" }> | undefined;

  // Assign each response a group, then pool the small ones.
  const groupOf = (a: Map<string, unknown>) => {
    if (!groupQuestion) return null;
    const v = a.get(groupQuestion.id);
    return groupQuestion.settings.options.find((o) => o.id === v)?.label ?? "Not given";
  };
  const counts = new Map<string, number>();
  for (const a of answers) {
    const g = groupOf(a);
    if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const big = [...counts.entries()]
    .filter(([, n]) => n >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g);
  const pooled = answers.filter((a) => {
    const g = groupOf(a);
    return g !== null && !big.includes(g);
  }).length;
  // Small groups pool into "Others". A pool still under the threshold
  // joins the smallest shown group (or, with none, no group is shown):
  // hiding it while it still counted in the overall would let anyone
  // work it out by subtracting the shown groups from the overall.
  const smallest = big[big.length - 1];
  const mergeInto = pooled > 0 && pooled < threshold ? smallest : undefined;
  const label = (g: string) => (g === mergeInto ? `${g} and others` : g);
  const groupLabels = [...big.map(label), ...(pooled >= threshold ? ["Others"] : [])];
  const shownGroupOf = (a: Map<string, unknown>) => {
    const g = groupOf(a);
    if (g === null) return null;
    if (big.includes(g)) return label(g);
    if (pooled >= threshold) return "Others";
    return mergeInto ? label(mergeInto) : null;
  };

  const scores = questions
    .filter((q) => SCORED.has(q.type) && q.id !== groupQuestion?.id)
    .map((q) => {
      const value = (a: Map<string, unknown>) => {
        const v = a.get(q.id);
        return typeof v === "number" && Number.isFinite(v) ? v : null;
      };
      const overallValues = answers.map(value).filter((v): v is number => v !== null);
      return {
        questionId: q.id,
        label: q.label.trim() || "Untitled",
        scale: scaleOf(q),
        overall: overallValues.length >= threshold ? mean(overallValues) : null,
        byGroup: groupLabels.map((g) => {
          const vs = answers
            .filter((a) => shownGroupOf(a) === g)
            .map(value)
            .filter((v): v is number => v !== null);
          return vs.length >= threshold ? mean(vs) : null;
        }),
      };
    });

  const choices = questions
    .filter(
      (
        q,
      ): q is Extract<
        QuestionV1,
        { type: "single_select" | "multi_select" | "dropdown" }
      > =>
        (q.type === "single_select" ||
          q.type === "multi_select" ||
          q.type === "dropdown") &&
        q.id !== groupQuestion?.id,
    )
    .map((q) => {
      const answered = answers.filter((a) => hasAnswer(q, a.get(q.id)));
      return {
        questionId: q.id,
        label: q.label.trim() || "Untitled",
        bars:
          answered.length >= threshold
            ? q.settings.options.map((o) => ({
                label: o.label,
                percent: Math.round(
                  (answered.filter((a) => {
                    const v = a.get(q.id);
                    return Array.isArray(v) ? v.includes(o.id) : v === o.id;
                  }).length /
                    answered.length) *
                    100,
                ),
              }))
            : [],
      };
    });

  const comments = questions
    .filter((q) => COMMENTS.has(q.type))
    .map((q) => {
      const texts = answers
        .map((a) => a.get(q.id))
        .filter((v): v is string => typeof v === "string" && v.trim() !== "")
        .map((v) => v.trim());
      return {
        questionId: q.id,
        label: q.label.trim() || "Untitled",
        texts: texts.length >= threshold ? scramble(texts) : [],
      };
    });

  return {
    threshold,
    responses: answers.length,
    shown: true,
    groups: groupLabels.map((g) => ({
      label: g,
      responses: answers.filter((a) => shownGroupOf(a) === g).length,
    })),
    hiddenResponses: big.length === 0 && pooled < threshold ? pooled : 0,
    scores,
    choices,
    comments,
  };
}

const MAX_REPORT_RESPONSES = 5000;

/** The report from the live data, with the service role (the database
 * hides individual rows from everyone signed in). The caller must have
 * checked the person may see this form's responses. */
export async function getFeedbackReport(
  admin: Client,
  formId: string,
  settings: ConfidentialSettings,
): Promise<FeedbackReport | null> {
  const { data: version } = await admin
    .from("form_versions")
    .select("schema")
    .eq("form_id", formId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!version) return null;
  const schema = parseFormSchema(version.schema);
  const { data: rows } = await admin
    .from("responses")
    .select("id")
    .eq("form_id", formId)
    .eq("status", "completed")
    .eq("is_preview", false)
    .eq("spam_suspected", false)
    .limit(MAX_REPORT_RESPONSES);
  const ids = (rows ?? []).map((r) => r.id);
  const byResponse = new Map(ids.map((id) => [id, new Map<string, unknown>()]));
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    for (let from = 0; ; from += 1000) {
      const { data } = await admin
        .from("answers")
        .select("response_id, question_id, value")
        .in("response_id", batch)
        .order("response_id")
        .order("question_id")
        .range(from, from + 999);
      for (const a of data ?? [])
        byResponse.get(a.response_id)?.set(a.question_id, a.value);
      if ((data?.length ?? 0) < 1000) break;
    }
  }
  return buildFeedbackReport(schema, settings, [...byResponse.values()]);
}
