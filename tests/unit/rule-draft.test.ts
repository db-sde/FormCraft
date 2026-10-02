import { describe, expect, it } from "vitest";
import { compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import { describeFormForAi, draftToRule, type RuleDraft } from "@/domains/ai/rule-draft";
import { walkForm } from "@/domains/logic";

const schema = parseFormSchema({
  schemaVersion: 1,
  meta: { title: "Signup" },
  theme: {},
  endings: [
    { id: "end", title: "Thanks", isDefault: true },
    { id: "end_student", title: "Student offer", isDefault: false },
  ],
  questions: [
    {
      id: "role",
      type: "single_select",
      order: 0,
      label: "What best describes you?",
      settings: {
        options: [
          { id: "o_student", label: "Student" },
          { id: "o_pro", label: "Professional" },
          { id: "o_other", label: "Other" },
        ],
      },
    },
    { id: "seats", type: "number", order: 1, label: "How many seats?", settings: {} },
    { id: "agree", type: "yes_no", order: 2, label: "Want a demo?", settings: {} },
    { id: "last", type: "short_text", order: 3, label: "Anything else?", settings: {} },
  ],
  logic: [],
  variables: [{ id: "v_score", name: "score", type: "number" }],
});

const blank: RuleDraft = {
  possible: true,
  reason: "",
  name: "Rule",
  trigger: { event: "question_answered", questionNumber: 1 },
  match: "all",
  conditions: [],
  actions: [],
  newVariables: [],
};

const draft = (overrides: Partial<RuleDraft>): RuleDraft => ({ ...blank, ...overrides });

const noAction = {
  questionNumber: null,
  endingId: null,
  variable: null,
  op: null,
  formula: null,
  candidates: [],
};

describe("describeFormForAi", () => {
  it("numbers questions and lists options, variables and endings", () => {
    const text = describeFormForAi(schema);
    expect(text).toContain("q1 [single_select] What best describes you?");
    expect(text).toContain("option: Professional");
    expect(text).toContain("score [number]");
    expect(text).toContain("end_student: Student offer");
  });
});

describe("draftToRule", () => {
  it("maps option labels to ids and question numbers to ids", () => {
    const result = draftToRule(
      draft({
        name: "Students skip seats",
        conditions: [
          {
            left: "q1",
            op: "eq",
            value: "student",
            values: [],
            value2: null,
            valueIsFormula: false,
          },
        ],
        actions: [{ ...noAction, type: "jump_to_question", questionNumber: 3 }],
      }),
      schema,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.rule).toMatchObject({
      name: "Students skip seats",
      on: { event: "question_answered", questionId: "role" },
      when: {
        type: "compare",
        left: { type: "answer", questionId: "role" },
        op: "eq",
        right: { type: "literal", value: "o_student" },
      },
      then: [{ type: "jump_to_question", questionId: "agree" }],
    });

    // And the engine follows it.
    const compiled = compileFormSchema({ ...schema, rules: [result.proposal.rule] });
    const walk = walkForm(compiled, { role: "o_student", agree: true, last: "x" });
    expect(walk.visitedQuestionIds).toEqual(["role", "agree", "last"]);
  });

  it("builds All/Any groups, lists, ranges and yes/no", () => {
    const result = draftToRule(
      draft({
        trigger: { event: "form_completed", questionNumber: null },
        match: "any",
        conditions: [
          {
            left: "q1",
            op: "any_of",
            value: null,
            values: ["Student", "Other"],
            value2: null,
            valueIsFormula: false,
          },
          {
            left: "q2",
            op: "between",
            value: "1",
            value2: "5",
            values: [],
            valueIsFormula: false,
          },
          {
            left: "q3",
            op: "eq",
            value: "no",
            values: [],
            value2: null,
            valueIsFormula: false,
          },
        ],
        actions: [{ ...noAction, type: "jump_to_ending", endingId: "end_student" }],
      }),
      schema,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.rule.when).toEqual({
      type: "any",
      conditions: [
        {
          type: "compare",
          left: { type: "answer", questionId: "role" },
          op: "any_of",
          right: { type: "literal", value: ["o_student", "o_other"] },
        },
        {
          type: "compare",
          left: { type: "answer", questionId: "seats" },
          op: "between",
          right: { type: "literal", value: 1 },
          right2: { type: "literal", value: 5 },
        },
        {
          type: "compare",
          left: { type: "answer", questionId: "agree" },
          op: "eq",
          right: { type: "literal", value: false },
        },
      ],
    });
  });

  it("creates the variables it needs and parses formulas", () => {
    const result = draftToRule(
      draft({
        trigger: { event: "question_answered", questionNumber: 2 },
        actions: [
          {
            ...noAction,
            type: "set_variable",
            variable: "total",
            op: "set",
            formula: "q2 * 12",
          },
          {
            ...noAction,
            type: "set_variable",
            variable: "score",
            op: "add",
            formula: "10",
          },
        ],
        newVariables: [{ name: "total", type: "number", initial: 0 }],
      }),
      schema,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [total] = result.proposal.newVariables;
    expect(total).toMatchObject({ name: "total", type: "number", initial: 0 });
    expect(result.proposal.rule.then[0]).toEqual({
      type: "set_variable",
      variableId: total.id,
      op: "set",
      value: {
        type: "binary",
        op: "*",
        left: { type: "answer", questionId: "seats" },
        right: { type: "literal", value: 12 },
      },
    });
  });

  it("compares two answers with a formula value", () => {
    const result = draftToRule(
      draft({
        trigger: { event: "question_answered", questionNumber: 2 },
        conditions: [
          {
            left: "score",
            op: "gt",
            value: "q2",
            values: [],
            value2: null,
            valueIsFormula: true,
          },
        ],
        actions: [{ ...noAction, type: "jump_to_question", questionNumber: 4 }],
      }),
      schema,
    );
    expect(result.ok && result.proposal.rule.when).toMatchObject({
      right: { type: "answer", questionId: "seats" },
    });
  });

  it("reports what's wrong instead of guessing", () => {
    const unknownOption = draftToRule(
      draft({
        conditions: [
          {
            left: "q1",
            op: "eq",
            value: "Teacher",
            values: [],
            value2: null,
            valueIsFormula: false,
          },
        ],
        actions: [{ ...noAction, type: "jump_to_question", questionNumber: 3 }],
      }),
      schema,
    );
    expect(unknownOption).toEqual({
      ok: false,
      message: "“Teacher” isn't an option of “What best describes you?”.",
    });

    const missingVariable = draftToRule(
      draft({
        actions: [{ ...noAction, type: "set_variable", variable: "nope", formula: "1" }],
      }),
      schema,
    );
    expect(missingVariable).toMatchObject({
      ok: false,
      message: expect.stringContaining("nope"),
    });

    expect(
      draftToRule(draft({ possible: false, reason: "Forms can't send SMS." }), schema),
    ).toEqual({ ok: false, message: "Forms can't send SMS." });

    expect(draftToRule(draft({ actions: [] }), schema)).toMatchObject({ ok: false });
  });

  it("runs the static analysis: a backward jump is rejected", () => {
    const result = draftToRule(
      draft({
        trigger: { event: "question_answered", questionNumber: 3 },
        actions: [{ ...noAction, type: "jump_to_question", questionNumber: 1 }],
      }),
      schema,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a variable name the schema wouldn't accept", () => {
    const result = draftToRule(
      draft({
        actions: [
          { ...noAction, type: "set_variable", variable: "Total Price", formula: "1" },
        ],
        newVariables: [{ name: "Total Price", type: "number", initial: null }],
      }),
      schema,
    );
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining("Total Price"),
    });
  });
});
