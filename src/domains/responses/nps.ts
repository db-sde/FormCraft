import type { QuestionV1 } from "@/domains/forms/schema/v1";

/** Whether a 0–10 opinion scale is a Net Promoter Score question. */
export function isNpsQuestion(question: QuestionV1): boolean {
  if (question.type !== "opinion_scale") return false;
  const { min, max, nps } = question.settings;
  if (min !== 0 || max !== 10) return false;
  return nps ?? /\brecommend/i.test(question.label);
}
