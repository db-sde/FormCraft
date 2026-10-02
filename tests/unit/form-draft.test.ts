import { describe, expect, it } from "vitest";
import { buildGeneratedForm, type FormDraft } from "@/domains/ai/form-draft";
import { compileFormSchema } from "@/domains/forms/schema";
import { walkForm } from "@/domains/logic";

const noAction = {
  questionNumber: null,
  endingId: null,
  variable: null,
  op: null,
  formula: null,
  candidates: [],
};

const quiz: FormDraft = {
  possible: true,
  reason: "",
  title: "Capital cities",
  intro: "Three quick questions.",
  questions: [
    {
      type: "single_select",
      label: "Capital of France?",
      description: "",
      required: true,
      options: [
        { label: "Paris", correct: true, points: [{ variable: "score", points: 1 }] },
        { label: "Lyon", correct: false, points: [] },
      ],
      scale: null,
    },
    {
      type: "single_select",
      label: "Capital of Japan?",
      description: "",
      required: true,
      options: [
        { label: "Tokyo", correct: true, points: [{ variable: "score", points: 1 }] },
        { label: "Osaka", correct: false, points: [] },
      ],
      scale: null,
    },
    {
      type: "rating",
      label: "How fun was this?",
      description: "",
      required: false,
      options: [],
      scale: 10,
    },
  ],
  variables: [{ name: "score", type: "number", initial: 0 }],
  endings: [
    { title: "Keep practising", description: "", isDefault: true },
    { title: "Perfect score!", description: "", isDefault: false },
  ],
  rules: [
    {
      name: "Perfect",
      trigger: { event: "form_completed", questionNumber: null },
      match: "all",
      conditions: [
        {
          left: "score",
          op: "gte",
          value: "2",
          values: [],
          value2: null,
          valueIsFormula: false,
        },
      ],
      actions: [{ ...noAction, type: "jump_to_ending", endingId: "ending_2" }],
    },
  ],
};

describe("buildGeneratedForm", () => {
  it("builds a valid quiz the engine scores", () => {
    const result = buildGeneratedForm(quiz);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { schema } = result;
    expect(result.warnings).toEqual([]);
    expect(schema.questions.map((q) => q.type)).toEqual([
      "welcome_screen",
      "single_select",
      "single_select",
      "rating",
    ]);
    expect(schema.questions[0]).toMatchObject({
      label: "Capital cities",
      description: "Three quick questions.",
    });
    expect(schema.questions[3].settings).toMatchObject({ scale: 10 });
    expect(schema.endings.map((e) => [e.id, e.isDefault])).toEqual([
      ["ending_1", true],
      ["ending_2", false],
    ]);

    const [france, japan] = schema.questions.slice(1, 3);
    const paris = (france.settings as { options: { id: string; correct?: boolean }[] })
      .options[0];
    const tokyo = (japan.settings as { options: { id: string }[] }).options[0];
    expect(paris.correct).toBe(true);

    const compiled = compileFormSchema(schema);
    expect(
      walkForm(compiled, { [france.id]: paris.id, [japan.id]: tokyo.id }).endingId,
    ).toBe("ending_2");
    expect(walkForm(compiled, { [france.id]: paris.id }).endingId).toBe("ending_1");
  });

  it("drops a rule that doesn't fit and says so", () => {
    const result = buildGeneratedForm({
      ...quiz,
      rules: [
        ...quiz.rules,
        {
          name: "Broken",
          trigger: { event: "question_answered", questionNumber: 1 },
          match: "all",
          conditions: [
            {
              left: "q1",
              op: "eq",
              value: "Marseille",
              values: [],
              value2: null,
              valueIsFormula: false,
            },
          ],
          actions: [{ ...noAction, type: "jump_to_question", questionNumber: 3 }],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schema.rules).toHaveLength(1);
    expect(result.warnings).toEqual([
      expect.stringContaining("Left out a rule (Broken): “Marseille” isn't an option"),
    ]);
  });

  it("skips unusable variables and points at them", () => {
    const result = buildGeneratedForm({
      ...quiz,
      variables: [{ name: "Total Score", type: "number", initial: null }],
      rules: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schema.variables).toEqual([]);
    const options = (
      result.schema.questions[1].settings as { options: { scores?: unknown }[] }
    ).options;
    expect(options[0].scores).toBeUndefined();
    expect(result.warnings[0]).toContain("Total Score");
  });

  it("supplies a default ending and refuses impossible requests", () => {
    const result = buildGeneratedForm({ ...quiz, endings: [], rules: [] });
    expect(result.ok && result.schema.endings).toEqual([
      { id: "ending_1", title: "Thank you!", isDefault: true },
    ]);
    expect(
      buildGeneratedForm({ ...quiz, possible: false, reason: "Not a form." }),
    ).toEqual({
      ok: false,
      message: "Not a form.",
    });
    expect(buildGeneratedForm({ ...quiz, questions: [] }).ok).toBe(false);
  });
});
