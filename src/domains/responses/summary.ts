import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { parseFormSchema } from "@/domains/forms/schema";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";
import { hasAnswer } from "@/domains/logic/validate-answer";
import { questionColumnLabel } from "./format";
import type { AnswerFilter, ResponseFilters } from "./dashboard";

type Client = SupabaseClient<Database>;

/** The summary reads at most this many of the newest matching responses,
 * so a very large form can't turn one page view into an unbounded scan. */
export const SUMMARY_RESPONSE_LIMIT = 2000;
const FETCH_PAGE = 1000;
const ID_BATCH = 100;
const QUOTE_COUNT = 3;

type Base = { questionId: string; number: number; label: string; answered: number };

export type QuestionSummary =
  | (Base & { kind: "choice"; bars: { label: string; count: number; percent: number }[] })
  | (Base & { kind: "rating"; scale: number; average: number | null })
  | (Base & {
      kind: "scale";
      min: number;
      max: number;
      counts: { value: number; count: number }[];
      average: number | null;
      /** Only for 0–10 scales: promoters (9–10) minus detractors (0–6). */
      nps: { score: number; promoters: number; detractors: number } | null;
    })
  | (Base & {
      kind: "number";
      average: number | null;
      min: number | null;
      max: number | null;
    })
  | (Base & { kind: "text"; quotes: string[] })
  | (Base & { kind: "count" });

export type ResponseSummary = {
  /** Completed responses the charts are based on. */
  total: number;
  /** True when more responses matched than SUMMARY_RESPONSE_LIMIT. */
  capped: boolean;
  questions: QuestionSummary[];
};

const percent = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((part / whole) * 100);

const mean = (values: number[]) =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

/**
 * Per-question summaries for a set of completed responses (Part 5,
 * Summary view). Questions come from the latest schema and are matched
 * to answers by their stable id, so answers given to an earlier version
 * of the same question still count. `answers` is newest response first,
 * which is the order text quotes are picked in.
 */
export function summarizeAnswers(
  schema: FormSchemaV1,
  answers: Map<string, unknown>[],
): QuestionSummary[] {
  const summaries: QuestionSummary[] = [];
  let number = 0;

  for (const question of schema.questions) {
    if (question.type === "welcome_screen") continue;
    number += 1;
    if (question.type === "statement") continue;

    const values = answers
      .map((a) => a.get(question.id))
      .filter((v) => hasAnswer(question, v));
    const base: Base = {
      questionId: question.id,
      number,
      label: questionColumnLabel(question),
      answered: values.length,
    };
    summaries.push(summarizeQuestion(question, values, base));
  }
  return summaries;
}

function summarizeQuestion(
  question: QuestionV1,
  values: unknown[],
  base: Base,
): QuestionSummary {
  switch (question.type) {
    case "single_select":
    case "multi_select":
    case "dropdown": {
      const counts = new Map<string, number>();
      let other = 0;
      for (const value of values) {
        for (const v of Array.isArray(value) ? value : [value]) {
          if (typeof v === "string" && v.startsWith("other:")) other += 1;
          else if (typeof v === "string") counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      }
      const bars = question.settings.options.map((o) => ({
        label: o.label,
        count: counts.get(o.id) ?? 0,
        percent: percent(counts.get(o.id) ?? 0, values.length),
      }));
      if (other > 0) {
        bars.push({
          label: "Other",
          count: other,
          percent: percent(other, values.length),
        });
      }
      bars.sort((a, b) => b.count - a.count);
      return { ...base, kind: "choice", bars };
    }

    case "yes_no": {
      const yes = values.filter((v) => v === true).length;
      const no = values.filter((v) => v === false).length;
      return {
        ...base,
        kind: "choice",
        bars: [
          {
            label: question.settings.yesLabel || "Yes",
            count: yes,
            percent: percent(yes, values.length),
          },
          {
            label: question.settings.noLabel || "No",
            count: no,
            percent: percent(no, values.length),
          },
        ],
      };
    }

    case "rating":
      return {
        ...base,
        kind: "rating",
        scale: question.settings.scale,
        average: mean(values.filter((v): v is number => typeof v === "number")),
      };

    case "opinion_scale": {
      const { min, max } = question.settings;
      const numbers = values.filter((v): v is number => typeof v === "number");
      const counts = [];
      for (let value = min; value <= max; value += 1) {
        counts.push({ value, count: numbers.filter((n) => n === value).length });
      }
      const isNps = min === 0 && max === 10;
      const promoters = numbers.filter((n) => n >= 9).length;
      const detractors = numbers.filter((n) => n <= 6).length;
      return {
        ...base,
        kind: "scale",
        min,
        max,
        counts,
        average: mean(numbers),
        nps:
          isNps && numbers.length > 0
            ? {
                score:
                  percent(promoters, numbers.length) -
                  percent(detractors, numbers.length),
                promoters: percent(promoters, numbers.length),
                detractors: percent(detractors, numbers.length),
              }
            : null,
      };
    }

    case "number": {
      const numbers = values.filter((v): v is number => typeof v === "number");
      return {
        ...base,
        kind: "number",
        average: mean(numbers),
        min: numbers.length ? Math.min(...numbers) : null,
        max: numbers.length ? Math.max(...numbers) : null,
      };
    }

    case "short_text":
    case "long_text":
      return {
        ...base,
        kind: "text",
        quotes: values
          .filter((v): v is string => typeof v === "string")
          .slice(0, QUOTE_COUNT),
      };

    default:
      return { ...base, kind: "count" };
  }
}

/** Summary of a form's completed responses, with the table's filters. */
export async function getResponseSummary(
  supabase: Client,
  formId: string,
  filters: ResponseFilters,
): Promise<ResponseSummary> {
  const { data: latest, error: schemaError } = await supabase
    .from("form_versions")
    .select("schema")
    .eq("form_id", formId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (schemaError) throw schemaError;
  if (!latest) return { total: 0, capped: false, questions: [] };
  const schema = parseFormSchema(latest.schema);

  // Newest matching completed responses, up to the limit.
  const ids: string[] = [];
  let total = 0;
  for (let from = 0; from < SUMMARY_RESPONSE_LIMIT; from += FETCH_PAGE) {
    const { data, error, count } = await completedQuery(supabase, formId, filters)
      .order("completed_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, Math.min(from + FETCH_PAGE, SUMMARY_RESPONSE_LIMIT) - 1);
    if (error) throw error;
    total = count ?? total;
    ids.push(...(data ?? []).map((r) => r.id));
    if ((data?.length ?? 0) < FETCH_PAGE) break;
  }

  const byResponse = new Map<string, Map<string, unknown>>(
    ids.map((id) => [id, new Map()]),
  );
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const batch = ids.slice(i, i + ID_BATCH);
    for (let from = 0; ; from += FETCH_PAGE) {
      const { data, error } = await supabase
        .from("answers")
        .select("response_id, question_id, value")
        .in("response_id", batch)
        .order("response_id")
        .order("question_id")
        .range(from, from + FETCH_PAGE - 1);
      if (error) throw error;
      for (const a of data ?? [])
        byResponse.get(a.response_id)?.set(a.question_id, a.value);
      if ((data?.length ?? 0) < FETCH_PAGE) break;
    }
  }

  return {
    total,
    capped: total > ids.length,
    questions: summarizeAnswers(
      schema,
      ids.map((id) => byResponse.get(id) ?? new Map()),
    ),
  };
}

function completedQuery(supabase: Client, formId: string, filters: ResponseFilters) {
  const answer: AnswerFilter | undefined = filters.answer;
  let query = supabase
    .from("responses")
    .select(answer ? "id, answer_match:answers!inner(question_id)" : "id", {
      count: "exact",
    })
    .eq("form_id", formId)
    .eq("status", "completed");
  if (filters.since) query = query.gte("completed_at", filters.since.toISOString());
  if (filters.endingId) query = query.eq("ending_id", filters.endingId);
  if (answer) {
    query = query
      .eq("answer_match.question_id", answer.questionId)
      .contains("answer_match.value", JSON.stringify(answer.value));
  }
  return query.returns<{ id: string }[]>();
}
