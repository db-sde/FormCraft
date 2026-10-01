import type { CompiledFormV1 } from "@/domains/forms/schema/compile";
import { evaluateNextStep, type AnswerMap } from "./evaluate";

export type WalkResult = {
  visitedQuestionIds: string[];
  endingId: string;
};

/**
 * Deterministically walks the compiled form from its first question to
 * an ending, given a complete set of answers. Used server-side at
 * submission time to determine (a) which questions were actually on the
 * respondent's path, so required-but-unreached questions are never
 * wrongly enforced, and (b) which ending was reached, authoritatively —
 * never trusted from the client.
 */
export function walkForm(compiled: CompiledFormV1, answers: AnswerMap): WalkResult {
  const visited: string[] = [];
  const seen = new Set<string>();

  let currentId: string | undefined = compiled.orderedQuestionIds[0];
  while (currentId) {
    if (seen.has(currentId)) {
      // Defensive: evaluateNextStep never steps onto a question already
      // visited, so this should be unreachable. If a future change breaks
      // that, fail closed to the form's default ending rather than looping.
      return { visitedQuestionIds: visited, endingId: compiled.defaultEndingId };
    }
    seen.add(currentId);
    visited.push(currentId);

    const next = evaluateNextStep(compiled, currentId, answers, seen);
    if (next.type === "ending") {
      return { visitedQuestionIds: visited, endingId: next.endingId };
    }
    currentId = next.questionId;
  }

  return { visitedQuestionIds: visited, endingId: compiled.defaultEndingId };
}
