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
 */
export function evaluateNextStep(
  compiled: CompiledFormV1,
  currentQuestionId: string,
  answers: AnswerMap,
): NextStep {
  const { schema, orderedQuestionIds, defaultEndingId } = compiled;

  const rules = schema.logic.filter((r) => r.questionId === currentQuestionId);
  for (const rule of rules) {
    if (evaluateCondition(rule, answers[rule.questionId])) {
      return rule.action.type === "jump_to_question"
        ? { type: "question", questionId: rule.action.questionId }
        : { type: "ending", endingId: rule.action.endingId };
    }
  }

  const currentIndex = orderedQuestionIds.indexOf(currentQuestionId);
  const nextId = orderedQuestionIds[currentIndex + 1];
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

function isAnswered(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
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
