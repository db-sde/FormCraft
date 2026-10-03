import type { QuestionPoolV1 } from "@/domains/forms/schema/logic-model";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { seededShuffle } from "./random";
import { hasAnswer } from "./validate-answer";

/**
 * Adaptive assessments (logic spec phase 20). An adaptive group is a
 * question pool whose questions each have a difficulty level (1–5). It
 * asks `pick` of them, one at a time: the first at the starting level,
 * then a harder one after a right answer and an easier one after a wrong
 * one. Which question comes next depends only on the answers so far and
 * the response's seed, so the browser and the server's walk always agree
 * — nothing about the sequence is trusted from the client.
 */

export const ADAPTIVE_LEVELS = [1, 2, 3, 4, 5] as const;
export const DEFAULT_ADAPTIVE_LEVEL = 3;

const clamp = (level: number) => Math.min(5, Math.max(1, level));

/** Whether a choice answer is the right one: every option marked correct
 * and no other. Null when the question has no marked answer (or isn't a
 * choice question), in which case the level doesn't move. */
export function isAnswerCorrect(question: QuestionV1, value: unknown): boolean | null {
  if (
    question.type !== "single_select" &&
    question.type !== "multi_select" &&
    question.type !== "dropdown"
  ) {
    return null;
  }
  const correct = question.settings.options.filter((o) => o.correct).map((o) => o.id);
  if (correct.length === 0) return null;
  const chosen = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  return chosen.length === correct.length && correct.every((id) => chosen.includes(id));
}

export function levelOf(pool: QuestionPoolV1, questionId: string): number {
  return clamp(pool.adaptive?.levels[questionId] ?? DEFAULT_ADAPTIVE_LEVEL);
}

/**
 * The questions an adaptive group asks, in order, as far as the answers
 * determine: every answered one, then the one to ask next (if the group
 * isn't finished). The next question is the unasked one closest to the
 * target level — ties go to the easier one, then by a seeded shuffle so
 * respondents don't all get the same question.
 */
export function adaptiveSequence(
  pool: QuestionPoolV1,
  questions: ReadonlyMap<string, QuestionV1>,
  answers: Record<string, unknown>,
  seed: string,
): { asked: string[]; complete: boolean } {
  const members = seededShuffle(
    pool.questionIds.filter((id) => questions.has(id)),
    `${seed}:${pool.id}`,
  );
  const total = Math.min(pool.pick, members.length);
  const asked: string[] = [];
  let level = clamp(pool.adaptive?.start ?? DEFAULT_ADAPTIVE_LEVEL);
  while (asked.length < total) {
    let next: string | null = null;
    let bestDistance = Infinity;
    let bestLevel = Infinity;
    for (const id of members) {
      if (asked.includes(id)) continue;
      const memberLevel = levelOf(pool, id);
      const distance = Math.abs(memberLevel - level);
      if (
        distance < bestDistance ||
        (distance === bestDistance && memberLevel < bestLevel)
      ) {
        next = id;
        bestDistance = distance;
        bestLevel = memberLevel;
      }
    }
    if (!next) break;
    asked.push(next);
    const question = questions.get(next)!;
    // Not answered yet: this is the one to ask; what follows isn't known.
    if (!hasAnswer(question, answers[next])) return { asked, complete: false };
    const correct = isAnswerCorrect(question, answers[next]);
    if (correct !== null) level = clamp(level + (correct ? 1 : -1));
  }
  return { asked, complete: true };
}
