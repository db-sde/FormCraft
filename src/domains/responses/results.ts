import type { Value } from "@/domains/forms/schema/logic-model";
import { compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import { walkForm } from "@/domains/logic/walk";

export type ResponseResults = {
  /** Final variable values, by variable name (scores, totals, segments…). */
  variables: Record<string, Value>;
  /** The URL values the response started with. */
  hidden: Record<string, string>;
};

/**
 * A completed response's computed results, re-derived from its own form
 * version and answers with the clock pinned to its submission time — so
 * the dashboard, CSV and webhooks always agree with what the respondent
 * was shown, and nothing derived is stored as truth.
 */
export function computeResponseResults(input: {
  schema: unknown;
  answers: Record<string, unknown>;
  hidden: unknown;
  completedAt: string | null;
}): ResponseResults {
  const hidden =
    input.hidden && typeof input.hidden === "object" && !Array.isArray(input.hidden)
      ? Object.fromEntries(
          Object.entries(input.hidden as Record<string, unknown>).filter(
            (e): e is [string, string] => typeof e[1] === "string",
          ),
        )
      : {};
  const schema = parseFormSchema(input.schema);
  if (!schema.variables?.length) return { variables: {}, hidden };
  const walk = walkForm(compileFormSchema(schema), input.answers, {
    hidden,
    now: input.completedAt ? new Date(input.completedAt) : undefined,
  });
  return {
    variables: Object.fromEntries(
      (schema.variables ?? []).map((v) => [v.name, walk.variables[v.id] ?? null]),
    ),
    hidden,
  };
}
