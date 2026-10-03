import { optionsFromOf } from "./options";
import type { Condition, Expr, RuleV1 } from "./schema/logic-model";
import type { FormSchemaV1, QuestionV1 } from "./schema/v1";
import { legacyToRule } from "@/domains/logic/engine";

/**
 * What in a form points at a question, ending or option — legacy logic,
 * rules, show conditions and checks — so the builder can warn before a
 * delete and remove the dangling pieces instead of leaving the draft
 * unsaveable. Every rule is read through the engine's model, so legacy
 * rules are covered by the same code.
 */

function exprUsesQuestion(expr: Expr, questionId: string): boolean {
  switch (expr.type) {
    case "answer":
      return expr.questionId === questionId;
    case "binary":
      return (
        exprUsesQuestion(expr.left, questionId) ||
        exprUsesQuestion(expr.right, questionId)
      );
    case "call":
      return expr.args.some((a) => exprUsesQuestion(a, questionId));
    default:
      return false;
  }
}

export function conditionUsesQuestion(condition: Condition, questionId: string): boolean {
  switch (condition.type) {
    case "all":
    case "any":
      return condition.conditions.some((c) => conditionUsesQuestion(c, questionId));
    case "not":
      return conditionUsesQuestion(condition.condition, questionId);
    case "compare":
      return [condition.left, condition.right, condition.right2].some(
        (e) => e !== undefined && exprUsesQuestion(e, questionId),
      );
  }
}

function ruleUsesQuestion(rule: RuleV1, questionId: string): boolean {
  if (rule.on.event === "question_answered" && rule.on.questionId === questionId)
    return true;
  if (rule.when && conditionUsesQuestion(rule.when, questionId)) return true;
  return rule.then.some(
    (a) =>
      (a.type === "jump_to_question" && a.questionId === questionId) ||
      (a.type === "set_variable" && exprUsesQuestion(a.value, questionId)),
  );
}

function ruleUsesEnding(rule: RuleV1, endingId: string): boolean {
  return rule.then.some(
    (a) =>
      (a.type === "jump_to_ending" && a.endingId === endingId) ||
      (a.type === "go_to_highest" && a.candidates.some((c) => c.endingId === endingId)),
  );
}

/** Every rule (legacy first, then `rules`), as the engine sees them. */
export function allRules(schema: FormSchemaV1): RuleV1[] {
  return [...schema.logic.map(legacyToRule), ...(schema.rules ?? [])];
}

export type References = {
  /** Rule ids, legacy or new. */
  ruleIds: string[];
  /** Questions whose show condition or checks use it. */
  questionIds: string[];
};

export function questionReferences(schema: FormSchemaV1, questionId: string): References {
  return {
    ruleIds: allRules(schema)
      .filter((r) => ruleUsesQuestion(r, questionId))
      .map((r) => r.id),
    questionIds: schema.questions
      .filter(
        (q) =>
          q.id !== questionId &&
          ((q.visibleIf && conditionUsesQuestion(q.visibleIf, questionId)) ||
            (q.validations ?? []).some(
              (v) =>
                conditionUsesQuestion(v.check, questionId) ||
                (v.when !== undefined && conditionUsesQuestion(v.when, questionId)),
            )),
      )
      .map((q) => q.id),
  };
}

export function endingReferences(schema: FormSchemaV1, endingId: string): string[] {
  return allRules(schema)
    .filter((r) => ruleUsesEnding(r, endingId))
    .map((r) => r.id);
}

function withoutRules(schema: FormSchemaV1, ruleIds: Set<string>): FormSchemaV1 {
  return {
    ...schema,
    logic: schema.logic.filter((r) => !ruleIds.has(r.id)),
    rules: schema.rules?.filter((r) => !ruleIds.has(r.id)),
  };
}

/** Removes everything that would dangle once `questionId` is gone:
 * rules that use it, and show conditions / checks on other questions
 * that read it (the question is then always shown / the check dropped). */
export function removeQuestionReferences(
  schema: FormSchemaV1,
  questionId: string,
): FormSchemaV1 {
  const refs = questionReferences(schema, questionId);
  const next = withoutRules(detachOptionsFrom(schema, questionId), new Set(refs.ruleIds));
  return {
    ...next,
    questions: next.questions.map((q) => {
      if (!refs.questionIds.includes(q.id)) return q;
      const visibleIf =
        q.visibleIf && conditionUsesQuestion(q.visibleIf, questionId)
          ? undefined
          : q.visibleIf;
      const validations = q.validations?.filter(
        (v) =>
          !conditionUsesQuestion(v.check, questionId) &&
          !(v.when && conditionUsesQuestion(v.when, questionId)),
      );
      return { ...q, visibleIf, validations } as QuestionV1;
    }),
    pools: withoutPoolMember(next.pools, questionId),
  };
}

/** Questions that carry options forward from `questionId`. */
export function optionsFromReferences(
  schema: FormSchemaV1,
  questionId: string,
): string[] {
  return schema.questions
    .filter((q) => optionsFromOf(q)?.questionId === questionId)
    .map((q) => q.id);
}

/** When a source question is deleted (or stops being a choice
 * question), its dependents keep the options they had as their own. */
export function detachOptionsFrom(
  schema: FormSchemaV1,
  questionId: string,
): FormSchemaV1 {
  const dependents = new Set(optionsFromReferences(schema, questionId));
  if (dependents.size === 0) return schema;
  return {
    ...schema,
    questions: schema.questions.map((q) => {
      if (!dependents.has(q.id)) return q;
      const settings = { ...(q.settings as Record<string, unknown>) };
      delete settings.optionsFrom;
      return { ...q, settings } as QuestionV1;
    }),
  };
}

/** A deleted question leaves its random group; a group left with fewer
 * than two questions goes, and `pick` shrinks to stay below the size. */
function withoutPoolMember(
  pools: FormSchemaV1["pools"],
  questionId: string,
): FormSchemaV1["pools"] {
  if (!pools) return pools;
  return pools.flatMap((pool) => {
    if (!pool.questionIds.includes(questionId)) return [pool];
    const questionIds = pool.questionIds.filter((id) => id !== questionId);
    if (questionIds.length < 2) return [];
    const adaptive = pool.adaptive && {
      ...pool.adaptive,
      levels: Object.fromEntries(
        Object.entries(pool.adaptive.levels).filter(([id]) => id !== questionId),
      ),
    };
    return [
      {
        ...pool,
        questionIds,
        pick: Math.min(pool.pick, questionIds.length - 1),
        ...(adaptive ? { adaptive } : {}),
      },
    ];
  });
}

export function removeEndingReferences(
  schema: FormSchemaV1,
  endingId: string,
): FormSchemaV1 {
  return withoutRules(schema, new Set(endingReferences(schema, endingId)));
}

/** Option ids a condition compares an answer of `questionId` against. */
function optionLiterals(
  condition: Condition,
  questionId: string,
  out: string[] = [],
): string[] {
  if (condition.type === "all" || condition.type === "any") {
    condition.conditions.forEach((c) => optionLiterals(c, questionId, out));
  } else if (condition.type === "not") {
    optionLiterals(condition.condition, questionId, out);
  } else if (
    condition.left.type === "answer" &&
    condition.left.questionId === questionId &&
    condition.right?.type === "literal"
  ) {
    const value = condition.right.value;
    for (const v of Array.isArray(value) ? value : [value]) {
      if (typeof v === "string") out.push(v);
    }
  }
  return out;
}

/** Rules that compare `questionId`'s answer with an option that's no
 * longer there — they'd silently never match, so they go with it. */
export function rulesBrokenByOptionChange(
  schema: FormSchemaV1,
  questionId: string,
  remainingOptionIds: ReadonlySet<string>,
): string[] {
  return allRules(schema)
    .filter(
      (r) =>
        r.when !== undefined &&
        optionLiterals(r.when, questionId).some((id) => !remainingOptionIds.has(id)),
    )
    .map((r) => r.id);
}

export function removeRules(schema: FormSchemaV1, ruleIds: string[]): FormSchemaV1 {
  return withoutRules(schema, new Set(ruleIds));
}

/** Rule ids whose question jumps would point backwards with the
 * questions ordered as `next` (and didn't before) — a reorder that
 * creates one is refused. */
export function jumpsBrokenByReorder(schema: FormSchemaV1, next: QuestionV1[]): string[] {
  const backward = (questions: QuestionV1[]) => {
    const pos = new Map(
      [...questions].sort((a, b) => a.order - b.order).map((q, i) => [q.id, i]),
    );
    return new Set(
      allRules(schema)
        .filter(
          (r) =>
            r.on.event === "question_answered" &&
            r.then.some(
              (a) =>
                a.type === "jump_to_question" &&
                (pos.get(a.questionId) ?? Infinity) <=
                  (pos.get((r.on as { questionId: string }).questionId) ?? -1),
            ),
        )
        .map((r) => r.id),
    );
  };
  const before = backward(schema.questions);
  return [...backward(next)].filter((id) => !before.has(id));
}
