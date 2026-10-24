import type { Value } from "@/domains/forms/schema/logic-model";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import { walkForm } from "@/domains/logic/walk";
import { hasRecall, renderRecall } from "@/domains/logic/recall";

export type ResponseResults = {
  /** Final variable values, by variable name (scores, totals, segments…). */
  variables: Record<string, Value>;
  /** The URL values the response started with. */
  hidden: Record<string, string>;
};

type ResultsInput = {
  /** The response's own form version (parsed or raw). */
  schema: unknown;
  answers: Record<string, unknown>;
  hidden: unknown;
  completedAt: string | null;
  /** The response's random seed (question pools). */
  seed?: string | null;
};

function hiddenOf(raw: unknown): Record<string, string> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? Object.fromEntries(
        Object.entries(raw as Record<string, unknown>).filter(
          (e): e is [string, string] => typeof e[1] === "string",
        ),
      )
    : {};
}

/** Replays the response through its form version: final variables by
 * variable id (empty when the form has none). */
function replay(input: ResultsInput) {
  const hidden = hiddenOf(input.hidden);
  const schema: FormSchemaV1 = parseFormSchema(input.schema);
  if (!schema.variables?.length) return { schema, hidden, variables: {} };
  const walk = walkForm(compileFormSchema(schema), input.answers, {
    hidden,
    now: input.completedAt ? new Date(input.completedAt) : undefined,
    seed: input.seed ?? undefined,
  });
  return { schema, hidden, variables: walk.variables };
}

/**
 * A completed response's computed results, re-derived from its own form
 * version and answers with the clock pinned to its submission time — so
 * the dashboard, CSV and webhooks always agree with what the respondent
 * was shown, and nothing derived is stored as truth.
 */
export function computeResponseResults(input: ResultsInput): ResponseResults {
  const { schema, hidden, variables } = replay(input);
  return {
    variables: Object.fromEntries(
      (schema.variables ?? []).map((v) => [v.name, variables[v.id] ?? null]),
    ),
    hidden,
  };
}

/** Text with recall (`{{score}}`, `{{answer:…}}`) filled in as this
 * respondent saw it — for an ending's title in the creator's views. */
export function renderForResponse(text: string, input: ResultsInput): string {
  if (!hasRecall(text)) return text;
  const { schema, hidden, variables } = replay(input);
  return renderRecall(text, { schema, answers: input.answers, variables, hidden });
}
