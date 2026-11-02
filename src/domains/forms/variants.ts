import type { FormSchemaV1, QuestionV1, VariantV1 } from "@/domains/forms/schema/v1";

/**
 * In-form A/B variants (master spec F-29) — the pure part, shared by the
 * runtime, the builder and the server.
 *
 * A variant changes only what respondents read and the shape they see
 * it in: question and option wording, question order, layout. Ids,
 * answers, validation and logic stay the original's, so responses from
 * every arm land in the same columns and reports. Reordering is allowed
 * only on forms without logic (jumps, show conditions, question pools):
 * with logic, order changes which questions a respondent reaches, and the
 * two arms would no longer be the same form.
 */

export const ORIGINAL = "original";

/** The schema a visitor in this arm sees. Unknown variants: the original. */
export function applyVariant(
  schema: FormSchemaV1,
  variantId: string | null | undefined,
): FormSchemaV1 {
  const variant = schema.variants?.find((v) => v.id === variantId);
  if (!variant) return schema;
  const byId = new Map(schema.questions.map((q) => [q.id, q]));
  let questions = schema.questions.map((q) => reword(q, variant));
  if (variant.order && isPermutation(variant.order, schema)) {
    questions = variant.order.map((id, order) => ({
      ...(questions.find((q) => q.id === id) ?? byId.get(id)!),
      order,
    })) as QuestionV1[];
  }
  return {
    ...schema,
    meta: { ...schema.meta, ...(variant.layout ? { layout: variant.layout } : {}) },
    questions,
  };
}

function reword(question: QuestionV1, variant: VariantV1): QuestionV1 {
  const change = variant.questions?.[question.id];
  if (!change) return question;
  const settings = question.settings as { options?: { id: string; label: string }[] };
  return {
    ...question,
    ...(change.label ? { label: change.label } : {}),
    ...(change.description !== undefined
      ? { description: change.description || undefined }
      : {}),
    ...(change.options && Array.isArray(settings.options)
      ? {
          settings: {
            ...question.settings,
            options: settings.options.map((o) =>
              change.options?.[o.id] ? { ...o, label: change.options[o.id] } : o,
            ),
          },
        }
      : {}),
  } as QuestionV1;
}

function isPermutation(order: string[], schema: FormSchemaV1): boolean {
  const ids = schema.questions.map((q) => q.id);
  if (order.length !== ids.length || new Set(order).size !== order.length) return false;
  if (!order.every((id) => ids.includes(id))) return false;
  const welcome = schema.questions.find((q) => q.type === "welcome_screen");
  return !welcome || order[0] === welcome.id;
}

export function hasLogic(schema: FormSchemaV1): boolean {
  return (
    schema.logic.length > 0 ||
    (schema.rules?.length ?? 0) > 0 ||
    (schema.pools?.length ?? 0) > 0 ||
    schema.questions.some((q) => q.visibleIf)
  );
}

/** What's wrong with a form's variants, for the builder and the save
 * check. */
export function variantProblems(schema: FormSchemaV1): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const variant of schema.variants ?? []) {
    const name = variant.name.trim() || "A variant";
    if (variant.id === ORIGINAL || ids.has(variant.id)) {
      problems.push(`${name} needs its own id.`);
    }
    ids.add(variant.id);
    for (const [questionId, change] of Object.entries(variant.questions ?? {})) {
      const question = schema.questions.find((q) => q.id === questionId);
      if (!question) {
        problems.push(`${name} rewords a question that isn't on the form.`);
        continue;
      }
      const options = (question.settings as { options?: { id: string }[] }).options ?? [];
      if (
        Object.keys(change.options ?? {}).some((id) => !options.some((o) => o.id === id))
      ) {
        problems.push(
          `${name} rewords an option of “${question.label}” that isn't there.`,
        );
      }
    }
    if (variant.order) {
      if (!isPermutation(variant.order, schema)) {
        problems.push(
          `${name}'s order must list every question once, welcome screen first.`,
        );
      } else if (hasLogic(schema)) {
        problems.push(
          `${name} changes the question order, which needs a form without logic (jumps, show conditions, question pools).`,
        );
      }
    }
  }
  return problems;
}

/** Which arm a visitor gets: stable per visitor and test. FNV-1a, so it
 * runs the same in the browser and on the server. */
export function assignVariant(
  testId: string,
  visitorId: string,
  split: number,
  variantId: string,
): string {
  let hash = 0x811c9dc5;
  for (const ch of `${testId}:${visitorId}`) {
    hash ^= ch.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100 < split ? variantId : ORIGINAL;
}
