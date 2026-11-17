import type { CompiledFormV1 } from "@/domains/forms/schema/compile";
import { nextStepFor, type AnswerMap, type EngineOptions } from "./engine";

/**
 * How far through the form a respondent is (F-51), along the way the
 * form's logic sends them rather than counting every question in it.
 *
 * Questions already shown count as done. The rest are predicted by
 * following the logic forward from the current question with the
 * answers given so far (unanswered ones as empty), so a branch that
 * skips ten questions doesn't leave the bar stuck at a third. It is an
 * estimate: a later answer can open a branch with more questions, and
 * the total grows. The share is never above 1.
 */
export type FormProgress = {
  /** The current question's number along the way taken (1-based). */
  current: number;
  /** Questions done plus the predicted rest, the current one included. */
  total: number;
  /** Predicted questions after the current one. */
  remaining: number;
  /** 0 to 1. */
  share: number;
};

/** Never follow more steps than this when predicting (a loop guard). */
const MAX_PREDICTED_STEPS = 500;

export function formProgress(
  compiled: CompiledFormV1,
  input: {
    currentId: string;
    answers: AnswerMap;
    /** Questions shown before the current one, in order. */
    history: readonly string[];
    /** Questions that are steps: not the welcome screen, page breaks or
     * pool questions this respondent wasn't dealt. */
    counted: ReadonlySet<string>;
    /** How much of the current step is done (lead capture asks a detail
     * at a time); 0 when unset. */
    currentShare?: number;
  },
  options: EngineOptions = {},
): FormProgress {
  const { currentId, answers, history, counted } = input;
  const done = history.filter((id) => counted.has(id)).length;
  const isCounted = counted.has(currentId);
  const current = isCounted ? done + 1 : done;

  // Follow the logic from here; stop at an ending, a question already on
  // the path (a legacy backward jump), or the guard.
  const path = [...history, currentId];
  const seen = new Set(path);
  let remaining = 0;
  for (let i = 0; i < MAX_PREDICTED_STEPS; i += 1) {
    const step = nextStepFor(compiled, answers, path, options).next;
    if (step.type !== "question" || seen.has(step.questionId)) break;
    seen.add(step.questionId);
    path.push(step.questionId);
    if (counted.has(step.questionId)) remaining += 1;
  }

  const total = Math.max(1, current + remaining);
  const share = Math.min(
    1,
    Math.max(0, (isCounted ? done + (input.currentShare ?? 0) : done) / total),
  );
  return { current, total, remaining, share };
}

export type ProgressLabel = "none" | "percent" | "count" | "remaining";

/** The words next to the bar for the creator's chosen style. */
export function progressText(
  progress: FormProgress,
  label: ProgressLabel,
): string | null {
  switch (label) {
    case "percent":
      return `${Math.round(progress.share * 100)}% complete`;
    case "count":
      return progress.current > 0
        ? `Question ${progress.current} of ${progress.total}`
        : null;
    case "remaining":
      return progress.remaining === 0
        ? "Last question"
        : `${progress.remaining} question${progress.remaining === 1 ? "" : "s"} left`;
    default:
      return null;
  }
}
