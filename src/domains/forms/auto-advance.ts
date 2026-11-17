import type { FormSchemaV1, QuestionV1 } from "./schema/v1";

/**
 * Configurable auto-advance (F-63). Choosing one of these is a complete
 * answer on its own, so the form can move on without an OK. A question
 * that takes several answers (checkboxes, ranking, a matrix) or typing
 * never does: moving on would cut the answer short.
 */
export const AUTO_ADVANCE_TYPES = new Set<QuestionV1["type"]>([
  "single_select",
  "yes_no",
  "rating",
  "opinion_scale",
  "dropdown",
]);

/** Whether choosing an answer on this question moves the form on: the
 * question's own setting, else the form's, else on. */
export function autoAdvances(
  question: QuestionV1,
  meta: Pick<FormSchemaV1["meta"], "autoAdvance">,
): boolean {
  if (!AUTO_ADVANCE_TYPES.has(question.type)) return false;
  return question.autoAdvance ?? meta.autoAdvance ?? true;
}
