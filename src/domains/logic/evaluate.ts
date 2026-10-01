import type { CompiledFormV1 } from "@/domains/forms/schema/compile";
import type { LogicRuleV1, QuestionV1 } from "@/domains/forms/schema/v1";

export type AnswerMap = Record<string, unknown>;

export type NextStep =
  { type: "question"; questionId: string } | { type: "ending"; endingId: string };

/**
 * The single deterministic logic-evaluation function used by BOTH the
 * builder preview and the public runtime (see ARCHITECTURE.md — logic
 * must not drift between the two). Given the compiled form, the current
 * question, and the answers gathered so far, returns where to go next.
 *
 * Rule evaluation order: rules are evaluated in schema array order;
 * the first matching rule for the current question wins. If no rule
 * matches, the default order-based next step applies.
 *
 * `visited` is every question already shown on this walk (including the
 * current one). The builder only allows forward jumps, so for any form
 * created today it never changes the answer. It exists for forms
 * published before that rule: a jump back to a question already shown
 * is ignored, and the default step skips questions already shown, so
 * every walk ends within as many steps as the form has questions.
 */
export function evaluateNextStep(
  compiled: CompiledFormV1,
  currentQuestionId: string,
  answers: AnswerMap,
  visited: ReadonlySet<string> = new Set([currentQuestionId]),
): NextStep {
  const { schema, orderedQuestionIds, defaultEndingId } = compiled;

  const rules = schema.logic.filter((r) => r.questionId === currentQuestionId);
  for (const rule of rules) {
    if (!evaluateCondition(rule, answers[rule.questionId])) continue;
    if (rule.action.type === "jump_to_ending") {
      return { type: "ending", endingId: rule.action.endingId };
    }
    if (!visited.has(rule.action.questionId)) {
      return { type: "question", questionId: rule.action.questionId };
    }
  }

  const currentIndex = orderedQuestionIds.indexOf(currentQuestionId);
  const nextId = orderedQuestionIds
    .slice(currentIndex + 1)
    .find((id) => !visited.has(id));
  return nextId
    ? { type: "question", questionId: nextId }
    : { type: "ending", endingId: defaultEndingId };
}

function evaluateCondition(rule: LogicRuleV1, answerValue: unknown): boolean {
  switch (rule.operator) {
    case "is_answered":
      return isAnswered(answerValue);
    case "is_not_answered":
      return !isAnswered(answerValue);
    case "equals":
      return looseEquals(answerValue, rule.value);
    case "not_equals":
      return !looseEquals(answerValue, rule.value);
    case "contains":
      return containsValue(answerValue, rule.value);
    case "gt":
      return (
        typeof answerValue === "number" &&
        typeof rule.value === "number" &&
        answerValue > rule.value
      );
    case "lt":
      return (
        typeof answerValue === "number" &&
        typeof rule.value === "number" &&
        answerValue < rule.value
      );
    default:
      return false;
  }
}

export function isAnswered(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    // Contact info: answered once any of its fields has text.
    return Object.values(value).some((v) => typeof v === "string" && v.trim() !== "");
  }
  return true;
}

function looseEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function containsValue(answerValue: unknown, target: unknown): boolean {
  if (Array.isArray(answerValue)) return answerValue.includes(target);
  if (typeof answerValue === "string" && typeof target === "string") {
    return answerValue.includes(target);
  }
  return false;
}

/** Whether a question is required AND currently reachable given the
 * answers so far — used by both client-side and server-side validation
 * so a question the respondent can never reach is never wrongly required. */
export function isQuestionRequiredAndReachable(
  question: QuestionV1,
  reachedQuestionIds: ReadonlySet<string>,
): boolean {
  return question.required && reachedQuestionIds.has(question.id);
}
