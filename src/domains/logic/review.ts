import type { CompiledFormV1 } from "@/domains/forms/schema/compile";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { NON_ANSWERABLE_TYPES } from "@/domains/forms/schema/question-types";
import { walkForm, type AnswerMap, type EngineOptions } from "./engine";
import { validateAnswer } from "./validate-answer";

/**
 * Pre-submission review (F-60). After an answer is changed from the
 * review, the form's logic runs again over every answer: a branch may
 * now lead to questions never asked, or past ones that no longer apply,
 * and a required question may now be on the way. Either everything on
 * the new path is answered and valid (back to the review), or the
 * respondent is taken to the first question that isn't.
 */
export type AfterEdit =
  | {
      kind: "review";
      /** Every question on the path, in order. */
      path: string[];
      endingId: string;
    }
  | {
      kind: "ask";
      questionId: string;
      /** The path before it: what "Back" walks through. */
      history: string[];
    };

export function afterReviewEdit(
  compiled: CompiledFormV1,
  answers: AnswerMap,
  /** Questions the respondent has already been shown. */
  shown: ReadonlySet<string>,
  options: EngineOptions = {},
): AfterEdit {
  const walk = walkForm(compiled, answers, options);
  const failing = new Set(walk.validationErrors.map((e) => e.questionId));
  const byId = new Map(compiled.schema.questions.map((q) => [q.id, q]));
  const path = walk.visitedQuestionIds;
  for (let i = 0; i < path.length; i += 1) {
    const question = byId.get(path[i]);
    if (!question) continue;
    const asked = shown.has(question.id);
    // A screen (welcome, statement) never shown before is on the way now:
    // it's shown, like any new question.
    const gap =
      !asked ||
      failing.has(question.id) ||
      (!NON_ANSWERABLE_TYPES.has(question.type) &&
        !validateAnswer(question, answers[question.id]).ok);
    if (gap) return { kind: "ask", questionId: question.id, history: path.slice(0, i) };
  }
  return { kind: "review", path, endingId: walk.endingId };
}

export type ReviewItem = { question: QuestionV1; section: string | null };

/**
 * What the review lists: the questions on the path that take an answer,
 * each under the page break (section) it follows in the form, so a long
 * form reads in the same chunks the creator wrote it in.
 */
export function reviewItems(
  compiled: CompiledFormV1,
  path: readonly string[],
): ReviewItem[] {
  const onPath = new Set(path);
  const items: ReviewItem[] = [];
  let section: string | null = null;
  for (const id of compiled.orderedQuestionIds) {
    const question = compiled.schema.questions.find((q) => q.id === id);
    if (!question) continue;
    if (question.type === "page_break") {
      section = question.label.trim() || null;
      continue;
    }
    if (NON_ANSWERABLE_TYPES.has(question.type) || !onPath.has(id)) continue;
    items.push({ question, section });
  }
  return items;
}
