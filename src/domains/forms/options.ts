import type { FormSchemaV1, OptionV1, QuestionV1 } from "./schema/v1";

/**
 * Carried-forward options (logic spec phase 8). A choice question can
 * take its options from an earlier choice question: the builder keeps
 * its `options` a copy of the source's (same ids and labels — so logic,
 * exports and charts need nothing special), and each respondent sees
 * only the ones they picked there (or didn't). Points and "correct"
 * stay the question's own: copying them would score the same pick twice.
 */

export const CHOICE_TYPES = new Set(["single_select", "multi_select", "dropdown"]);

type OptionsFrom = { questionId: string; include: "selected" | "not_selected" };

export function optionsFromOf(question: QuestionV1 | undefined): OptionsFrom | undefined {
  return (question?.settings as { optionsFrom?: OptionsFrom } | undefined)?.optionsFrom;
}

function optionsOf(question: QuestionV1): OptionV1[] {
  return (question.settings as { options?: OptionV1[] }).options ?? [];
}

/** Every carried-forward question's options made a fresh copy of its
 * source's. Returns the same object when nothing changed. */
export function syncCarriedOptions(schema: FormSchemaV1): FormSchemaV1 {
  let changed = false;
  const byId = new Map(schema.questions.map((q) => [q.id, q]));
  const questions = schema.questions.map((question) => {
    const from = optionsFromOf(question);
    const source = from ? byId.get(from.questionId) : undefined;
    if (!from || !source || !CHOICE_TYPES.has(source.type)) return question;
    const own = new Map(optionsOf(question).map((o) => [o.id, o]));
    const next = optionsOf(source).map((o) => {
      const mine = own.get(o.id);
      return {
        id: o.id,
        label: o.label,
        ...(mine?.scores ? { scores: mine.scores } : {}),
        ...(mine?.correct ? { correct: mine.correct } : {}),
      };
    });
    const current = optionsOf(question);
    if (
      next.length === current.length &&
      next.every((o, i) => o.id === current[i].id && o.label === current[i].label)
    ) {
      return question;
    }
    changed = true;
    return {
      ...question,
      settings: { ...question.settings, options: next },
    } as QuestionV1;
  });
  return changed ? { ...schema, questions } : schema;
}

/** The option ids this respondent can choose from on a carried-forward
 * question, from their answer to the source; null = not carried forward. */
export function availableOptionIds(
  question: QuestionV1,
  answers: Record<string, unknown>,
): Set<string> | null {
  const from = optionsFromOf(question);
  if (!from) return null;
  const answer = answers[from.questionId];
  const picked = new Set(
    (Array.isArray(answer) ? answer : [answer]).filter(
      (v): v is string => typeof v === "string",
    ),
  );
  return new Set(
    optionsOf(question)
      .map((o) => o.id)
      .filter((id) => (from.include === "selected" ? picked.has(id) : !picked.has(id))),
  );
}

/** Whether an answer only uses options this respondent was shown. */
export function answerUsesAvailableOptions(
  question: QuestionV1,
  value: unknown,
  answers: Record<string, unknown>,
): boolean {
  const available = availableOptionIds(question, answers);
  if (!available) return true;
  return (Array.isArray(value) ? value : [value])
    .filter((v) => v !== null && v !== undefined)
    .every((v) => typeof v === "string" && (v.startsWith("other:") || available.has(v)));
}
