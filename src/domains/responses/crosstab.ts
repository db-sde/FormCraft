import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";
import { hasAnswer } from "@/domains/logic/validate-answer";
import { loadCompletedAnswers } from "./summary";
import type { ResponseFilters } from "./dashboard";

type Client = SupabaseClient<Database>;

/**
 * Cross-tabs (master spec F-30): how answers to one question break down
 * by the answers to another, over the same completed responses (and
 * filters) the summary uses. Every response lands in a row and a column —
 * "No answer" included — so the table adds up to the response count.
 * A checkbox question counts a response once for each option chosen; the
 * table says so.
 */

export const NO_ANSWER = "__none";
export const CROSSTAB_TYPES = new Set([
  "single_select",
  "multi_select",
  "dropdown",
  "yes_no",
  "rating",
  "opinion_scale",
]);

export type Category = { key: string; label: string };

export function crossTabQuestions(schema: FormSchemaV1): QuestionV1[] {
  return [...schema.questions]
    .sort((a, b) => a.order - b.order)
    .filter((q) => CROSSTAB_TYPES.has(q.type));
}

/** A question's answer categories, "No answer" last. */
export function categoriesOf(question: QuestionV1): Category[] {
  const out: Category[] = [];
  switch (question.type) {
    case "single_select":
    case "multi_select":
    case "dropdown":
      out.push(...question.settings.options.map((o) => ({ key: o.id, label: o.label })));
      if (question.type !== "dropdown" && question.settings.allowOther) {
        out.push({ key: "other", label: "Other" });
      }
      break;
    case "yes_no":
      out.push(
        { key: "true", label: question.settings.yesLabel || "Yes" },
        { key: "false", label: question.settings.noLabel || "No" },
      );
      break;
    case "rating":
      for (let i = 1; i <= question.settings.scale; i += 1)
        out.push({ key: String(i), label: String(i) });
      break;
    case "opinion_scale":
      for (let i = question.settings.min; i <= question.settings.max; i += 1) {
        out.push({ key: String(i), label: String(i) });
      }
      break;
  }
  out.push({ key: NO_ANSWER, label: "No answer" });
  return out;
}

/** The categories one answer falls into (several for checkboxes). */
export function keysOf(question: QuestionV1, value: unknown): string[] {
  if (!hasAnswer(question, value)) return [NO_ANSWER];
  const known = new Set(categoriesOf(question).map((c) => c.key));
  const keys = (Array.isArray(value) ? value : [value]).map((v) =>
    typeof v === "string" && v.startsWith("other:") ? "other" : String(v),
  );
  const matched = [...new Set(keys.filter((k) => known.has(k)))];
  return matched.length ? matched : [NO_ANSWER];
}

export type CrossTab = {
  rows: Category[];
  columns: Category[];
  /** cells[row][column] */
  cells: number[][];
  rowTotals: number[];
  columnTotals: number[];
  /** Responses counted (each once, whatever it answered). */
  responses: number;
  /** True when a checkbox question can count a response more than once. */
  multiCounted: boolean;
  /** More responses matched than were read (see SUMMARY_RESPONSE_LIMIT). */
  capped: boolean;
};

/** The table for answers already loaded (pure, for tests and exports). */
export function buildCrossTab(
  rowQuestion: QuestionV1,
  columnQuestion: QuestionV1,
  answers: Map<string, unknown>[],
): Omit<CrossTab, "capped"> {
  const rows = categoriesOf(rowQuestion);
  const columns = categoriesOf(columnQuestion);
  const cells = rows.map(() => columns.map(() => 0));
  for (const a of answers) {
    for (const r of keysOf(rowQuestion, a.get(rowQuestion.id))) {
      for (const c of keysOf(columnQuestion, a.get(columnQuestion.id))) {
        cells[rows.findIndex((x) => x.key === r)][
          columns.findIndex((x) => x.key === c)
        ] += 1;
      }
    }
  }
  return {
    rows,
    columns,
    cells,
    rowTotals: cells.map((row) => row.reduce((s, n) => s + n, 0)),
    columnTotals: columns.map((_, j) => cells.reduce((s, row) => s + row[j], 0)),
    responses: answers.length,
    multiCounted:
      rowQuestion.type === "multi_select" || columnQuestion.type === "multi_select",
  };
}

/** The cross-tab of two questions over the filtered completed responses,
 * read as the caller (RLS). */
export async function getCrossTab(
  supabase: Client,
  formId: string,
  schema: FormSchemaV1,
  rowId: string,
  columnId: string,
  filters: ResponseFilters,
): Promise<CrossTab | null> {
  const row = schema.questions.find((q) => q.id === rowId && CROSSTAB_TYPES.has(q.type));
  const column = schema.questions.find(
    (q) => q.id === columnId && CROSSTAB_TYPES.has(q.type),
  );
  if (!row || !column) return null;
  const { total, ids, byResponse } = await loadCompletedAnswers(
    supabase,
    formId,
    filters,
  );
  return {
    ...buildCrossTab(
      row,
      column,
      ids.map((id) => byResponse.get(id) ?? new Map()),
    ),
    capped: total > ids.length,
  };
}

/** The table as CSV rows (the dashboard's numbers, cell for cell). */
export function crossTabRows(
  table: Omit<CrossTab, "capped">,
  rowLabel: string,
  columnLabel: string,
): string[][] {
  return [
    [`${rowLabel} \\ ${columnLabel}`, ...table.columns.map((c) => c.label), "Total"],
    ...table.rows.map((r, i) => [
      r.label,
      ...table.cells[i].map(String),
      String(table.rowTotals[i]),
    ]),
    [
      "Total",
      ...table.columnTotals.map(String),
      String(table.rowTotals.reduce((s, n) => s + n, 0)),
    ],
  ];
}
