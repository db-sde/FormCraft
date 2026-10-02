import type { CompiledFormV1 } from "@/domains/forms/schema/compile";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { nextStepFor, type AnswerMap, type EngineOptions, type NextStep } from "./engine";

export type { AnswerMap, NextStep } from "./engine";

/**
 * Where to go after `currentQuestionId` — the single deterministic step
 * function shared by the builder preview, the public runtime and (via
 * walkForm) the server; see engine.ts for the evaluation order.
 *
 * `visited` is every question already shown on this walk, in order,
 * including the current one. Earlier ones are replayed so variables and
 * scores are always derived from the answers, and none of them is ever
 * shown again (jumps only go forward, so every walk ends).
 */
export function evaluateNextStep(
  compiled: CompiledFormV1,
  currentQuestionId: string,
  answers: AnswerMap,
  visited: ReadonlySet<string> = new Set([currentQuestionId]),
  options: EngineOptions = {},
): NextStep {
  const path = [...visited].filter((id) => id !== currentQuestionId);
  path.push(currentQuestionId);
  return nextStepFor(compiled, answers, path, options).next;
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

/** Whether a question is required AND currently reachable given the
 * answers so far — used by both client-side and server-side validation
 * so a question the respondent can never reach is never wrongly required. */
export function isQuestionRequiredAndReachable(
  question: QuestionV1,
  reachedQuestionIds: ReadonlySet<string>,
): boolean {
  return question.required && reachedQuestionIds.has(question.id);
}
