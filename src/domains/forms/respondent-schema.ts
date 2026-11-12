import type { FormSchemaV1, QuestionV1 } from "./schema/v1";

/**
 * The form as sent to the respondent's browser, without what would give
 * a quiz away (QA FC4-02): which option is correct, and how many points
 * each is worth. Scoring is done again on the server from the stored
 * form, so the browser only needs them where it must decide something
 * itself, mid-form:
 *
 * - `correct` only for questions in an adaptive group, which picks the
 *   next question from whether the last answer was right;
 * - option points only when a score is used before the end: a question
 *   rule, a show condition or check, or a question's text that shows a
 *   score. At the end the server sends the final scores back with the
 *   ending (see /complete), so an ending's "You scored {{score}}" still
 *   reads right;
 * - no end-of-form rules: the server chooses the ending.
 */
export function respondentSchema(schema: FormSchemaV1): FormSchemaV1 {
  const adaptive = new Set(
    (schema.pools ?? []).filter((p) => p.adaptive).flatMap((p) => p.questionIds),
  );
  const keepPoints = scoresUsedMidForm(schema);

  return {
    ...schema,
    questions: schema.questions.map((question) =>
      stripQuestion(question, !adaptive.has(question.id), !keepPoints),
    ),
    // End-of-form rules (score thresholds, which ending) run on the
    // server, which sends back the ending and the final scores (QA
    // FC5-06). The browser only needs the rules it navigates by.
    ...(schema.rules
      ? { rules: schema.rules.filter((rule) => rule.on.event !== "form_completed") }
      : {}),
  };
}

function stripQuestion(
  question: QuestionV1,
  dropCorrect: boolean,
  dropPoints: boolean,
): QuestionV1 {
  const settings = question.settings as { options?: unknown };
  if (!Array.isArray(settings.options)) return question;
  const options = (settings.options as Record<string, unknown>[]).map((option) => {
    if (!(dropCorrect && "correct" in option) && !(dropPoints && "scores" in option)) {
      return option;
    }
    const copy = { ...option };
    if (dropCorrect) delete copy.correct;
    if (dropPoints) delete copy.scores;
    return copy;
  });
  return { ...question, settings: { ...question.settings, options } } as QuestionV1;
}

/** Whether a score (variable) decides anything before the form ends. */
export function scoresUsedMidForm(schema: FormSchemaV1): boolean {
  const variables = schema.variables ?? [];
  if (variables.length === 0) return false;

  // Rules that run as the respondent goes (not the completion ones), and
  // the questions' show conditions and checks, refer to a variable by id.
  const midFormRules = (schema.rules ?? []).filter(
    (rule) => rule.on.event !== "form_completed",
  );
  const questionLogic = schema.questions.map((q) => [q.visibleIf, q.validations]);
  const logicText = JSON.stringify({ midFormRules, questionLogic });
  if (variables.some((v) => logicText.includes(`"${v.id}"`))) return true;

  // Wording anywhere in a question (title, description, options, button)
  // that shows a score: "So far: {{score}}". Option points are left out
  // of this text; they're what's being decided on.
  const wording = JSON.stringify(
    schema.questions.map((q) => stripQuestion(q, true, true)),
  );
  return variables.some((v) => wording.includes(`{{${v.name}}}`));
}
