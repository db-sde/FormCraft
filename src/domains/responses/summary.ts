import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import type { CompiledFormV1 } from "@/domains/forms/schema/compile";
import type { Value } from "@/domains/forms/schema/logic-model";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";
import { hasAnswer } from "@/domains/logic/validate-answer";
import { walkForm } from "@/domains/logic/walk";
import { formatValue, RECALL_PATTERN } from "@/domains/logic/recall";
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

export type VariableSummary =
  | {
      variableId: string;
      name: string;
      kind: "number";
      count: number;
      average: number | null;
      min: number | null;
      max: number | null;
    }
  | {
      variableId: string;
      name: string;
      kind: "values";
      count: number;
      /** Most common values first (segments, grades, yes/no…). */
      bars: { label: string; count: number; percent: number }[];
    };

/** Logic results across responses (Phase 37): where people ended up and
 * what the form worked out for them. */
export type OutcomeSummary = {
  endings: { endingId: string; title: string; count: number; percent: number }[];
  variables: VariableSummary[];
};

export type ResponseSummary = {
  /** Completed responses the charts are based on. */
  total: number;
  /** True when more responses matched than SUMMARY_RESPONSE_LIMIT. */
  capped: boolean;
  questions: QuestionSummary[];
  outcomes: OutcomeSummary;
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

const VALUE_BARS = 8;

/** An ending's title with recall tokens named rather than filled in
 * ("Let's talk, [What's your name?]") — it's many people's ending. */
function readableTitle(schema: FormSchemaV1, endingId: string): string {
  const title = schema.endings.find((e) => e.id === endingId)?.title.trim();
  if (!title) return "A removed ending";
  return title.replace(RECALL_PATTERN, (_m, token: string) => {
    if (!token.startsWith("answer:")) return `[${token}]`;
    const label = schema.questions.find((q) => q.id === token.slice(7))?.label.trim();
    return `[${label || "an answer"}]`;
  });
}

/**
 * Endings reached and variable results, for responses already walked
 * (each with its own version, URL values and submission time). Endings
 * and variables are named from the latest schema by stable id; an ending
 * or variable since deleted is still counted, under a placeholder name.
 */
export function summarizeOutcomes(
  schema: FormSchemaV1,
  rows: { endingId: string | null; variables: Record<string, Value> }[],
): OutcomeSummary {
  const endingCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.endingId)
      endingCounts.set(row.endingId, (endingCounts.get(row.endingId) ?? 0) + 1);
  }
  const reached = rows.filter((r) => r.endingId).length;
  const endingOrder = (id: string) => {
    const index = schema.endings.findIndex((e) => e.id === id);
    return index === -1 ? schema.endings.length : index;
  };
  const endings = [...endingCounts]
    .map(([endingId, count]) => ({
      endingId,
      title: readableTitle(schema, endingId),
      count,
      percent: percent(count, reached),
    }))
    // Most reached first; ties in the form's own ending order.
    .sort(
      (a, b) => b.count - a.count || endingOrder(a.endingId) - endingOrder(b.endingId),
    );

  const variables: VariableSummary[] = (schema.variables ?? []).map((v) => {
    const values = rows
      .map((r) => r.variables[v.id])
      .filter((x) => x !== null && x !== undefined && x !== "");
    if (v.type === "number") {
      const numbers = values.filter(
        (x): x is number => typeof x === "number" && Number.isFinite(x),
      );
      return {
        variableId: v.id,
        name: v.name,
        kind: "number",
        count: numbers.length,
        average: mean(numbers),
        min: numbers.length ? Math.min(...numbers) : null,
        max: numbers.length ? Math.max(...numbers) : null,
      };
    }
    const counts = new Map<string, number>();
    for (const value of values) {
      for (const item of v.type === "list" && Array.isArray(value) ? value : [value]) {
        const label = formatValue(item as Value);
        if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    return {
      variableId: v.id,
      name: v.name,
      kind: "values",
      count: values.length,
      bars: [...counts]
        .map(([label, count]) => ({
          label,
          count,
          percent: percent(count, values.length),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, VALUE_BARS),
    };
  });
  return { endings, variables };
}

type CompletedRow = {
  id: string;
  ending_id: string | null;
  form_version_id: string;
  hidden_fields: unknown;
  completed_at: string | null;
};

function storedHidden(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
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
  if (!latest) {
    return {
      total: 0,
      capped: false,
      questions: [],
      outcomes: { endings: [], variables: [] },
    };
  }
  const schema = parseFormSchema(latest.schema);

  // Newest matching completed responses, up to the limit.
  const rows: CompletedRow[] = [];
  let total = 0;
  for (let from = 0; from < SUMMARY_RESPONSE_LIMIT; from += FETCH_PAGE) {
    const { data, error, count } = await completedQuery(supabase, formId, filters)
      .order("completed_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, Math.min(from + FETCH_PAGE, SUMMARY_RESPONSE_LIMIT) - 1);
    if (error) throw error;
    total = count ?? total;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < FETCH_PAGE) break;
  }

  const ids = rows.map((r) => r.id);
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
    outcomes: summarizeOutcomes(
      schema,
      await walkResponses(supabase, schema, rows, byResponse),
    ),
  };
}

/** Each response's variables, replayed with the version it was served
 * (schemas fetched once per version) — skipped when no version of the
 * form has variables. */
async function walkResponses(
  supabase: Client,
  latest: FormSchemaV1,
  rows: CompletedRow[],
  answers: Map<string, Map<string, unknown>>,
): Promise<{ endingId: string | null; variables: Record<string, Value> }[]> {
  if (!latest.variables?.length) {
    return rows.map((r) => ({ endingId: r.ending_id, variables: {} }));
  }
  const versionIds = [...new Set(rows.map((r) => r.form_version_id))];
  const compiled = new Map<string, CompiledFormV1 | null>();
  for (let i = 0; i < versionIds.length; i += ID_BATCH) {
    const { data, error } = await supabase
      .from("form_versions")
      .select("id, schema")
      .in("id", versionIds.slice(i, i + ID_BATCH));
    if (error) throw error;
    for (const v of data ?? []) {
      try {
        const parsed = parseFormSchema(v.schema);
        compiled.set(v.id, parsed.variables?.length ? compileFormSchema(parsed) : null);
      } catch {
        compiled.set(v.id, null);
      }
    }
  }
  return rows.map((r) => {
    const form = compiled.get(r.form_version_id);
    if (!form) return { endingId: r.ending_id, variables: {} };
    const walk = walkForm(form, Object.fromEntries(answers.get(r.id) ?? new Map()), {
      hidden: storedHidden(r.hidden_fields),
      now: r.completed_at ? new Date(r.completed_at) : undefined,
    });
    return { endingId: r.ending_id, variables: walk.variables };
  });
}

const COMPLETED_COLUMNS = "id, ending_id, form_version_id, hidden_fields, completed_at";

function completedQuery(supabase: Client, formId: string, filters: ResponseFilters) {
  const answer: AnswerFilter | undefined = filters.answer;
  let query = supabase
    .from("responses")
    .select(
      answer
        ? `${COMPLETED_COLUMNS}, answer_match:answers!inner(question_id)`
        : COMPLETED_COLUMNS,
      {
        count: "exact",
      },
    )
    .eq("form_id", formId)
    .eq("status", "completed");
  if (filters.since) query = query.gte("completed_at", filters.since.toISOString());
  if (filters.endingId) query = query.eq("ending_id", filters.endingId);
  if (answer) {
    query = query
      .eq("answer_match.question_id", answer.questionId)
      .contains("answer_match.value", JSON.stringify(answer.value));
  }
  return query.returns<CompletedRow[]>();
}
