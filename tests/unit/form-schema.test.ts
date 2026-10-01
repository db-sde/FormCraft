import { describe, expect, it } from "vitest";
import {
  parseFormSchema,
  validateSemantics,
  validateForPublish,
  compileFormSchema,
  FormSchemaError,
  describeSchemaProblem,
  FormSchemaV1 as FormSchemaV1Zod,
} from "@/domains/forms/schema";
import { z } from "zod";

function baseSchema(): z.input<typeof FormSchemaV1Zod> {
  return {
    schemaVersion: 1 as const,
    meta: { title: "Test form" },
    theme: {},
    endings: [{ id: "end1", title: "Thanks!", isDefault: true }],
    questions: [
      {
        id: "q1",
        type: "short_text" as const,
        order: 0,
        label: "Name",
        required: true,
        settings: {},
      },
      {
        id: "q2",
        type: "email" as const,
        order: 1,
        label: "Email",
        required: true,
        settings: {},
      },
    ],
    logic: [],
  };
}

describe("parseFormSchema", () => {
  it("accepts a minimal valid schema", () => {
    const parsed = parseFormSchema(baseSchema());
    expect(parsed.questions).toHaveLength(2);
  });

  it("rejects a schema missing required top-level fields", () => {
    expect(() => parseFormSchema({ schemaVersion: 1 })).toThrow(FormSchemaError);
  });

  it("rejects an unsupported question type", () => {
    const schema = baseSchema();
    // @ts-expect-error intentionally invalid
    schema.questions[0].type = "carrier_pigeon";
    expect(() => parseFormSchema(schema)).toThrow(FormSchemaError);
  });

  it("strips NUL characters by rejecting them", () => {
    const schema = baseSchema();
    schema.questions[0].label = "bad\u0000label";
    expect(() => parseFormSchema(schema)).toThrow(FormSchemaError);
  });

  it("preserves unicode including emoji", () => {
    const schema = baseSchema();
    schema.meta.title = "Café ☕ 表单 🎉";
    const parsed = parseFormSchema(schema);
    expect(parsed.meta.title).toBe("Café ☕ 表单 🎉");
  });
});

describe("validateSemantics", () => {
  it("passes for a well-formed schema", () => {
    expect(() => validateSemantics(parseFormSchema(baseSchema()))).not.toThrow();
  });

  it("rejects duplicate question ids", () => {
    const schema = baseSchema();
    schema.questions[1].id = "q1";
    expect(() => validateSemantics(parseFormSchema(schema))).toThrow(
      /duplicate question id/,
    );
  });

  it("rejects a logic rule with a dangling target", () => {
    const schema = baseSchema();
    schema.logic.push({
      id: "l1",
      questionId: "q1",
      operator: "is_answered",
      action: { type: "jump_to_question", questionId: "does_not_exist" },
    });
    expect(() => validateSemantics(parseFormSchema(schema))).toThrow(/unknown question/);
  });

  it("requires exactly one default ending", () => {
    const schema = baseSchema();
    schema.endings.push({ id: "end2", title: "Also thanks", isDefault: true });
    expect(() => validateSemantics(parseFormSchema(schema))).toThrow(
      /exactly one ending/,
    );
  });
});

describe("compileFormSchema", () => {
  it("compiles a linear form with no logic", () => {
    const compiled = compileFormSchema(parseFormSchema(baseSchema()));
    expect(compiled.orderedQuestionIds).toEqual(["q1", "q2"]);
    expect(compiled.defaultEndingId).toBe("end1");
  });

  it("still compiles a form published with a backward jump, so it keeps being served", () => {
    const schema = baseSchema();
    schema.questions.push({
      id: "q3",
      type: "short_text",
      order: 2,
      label: "Loop target",
      required: false,
      settings: {},
    });
    // The builder no longer lets a creator save this (see validateSemantics
    // below), but forms published before that rule must not stop loading.
    schema.logic.push({
      id: "l1",
      questionId: "q3",
      operator: "is_answered",
      action: { type: "jump_to_question", questionId: "q2" },
    });
    expect(() => compileFormSchema(parseFormSchema(schema))).not.toThrow();
  });

  it("keeps trailing questions reachable via the default order chain even when an earlier question can jump straight to an ending", () => {
    const schema = baseSchema();
    schema.questions.push({
      id: "q3",
      type: "short_text",
      order: 2,
      label: "Still reachable",
      required: false,
      settings: {},
    });
    // A conditional jump from q1 to the ending does not remove the
    // *default* edge q1 -> q2 -> q3 (the condition might not match), so
    // the compiler's conservative reachability graph must still consider
    // q2/q3 reachable rather than flagging them as dead content.
    schema.logic.push({
      id: "l1",
      questionId: "q1",
      operator: "is_answered",
      action: { type: "jump_to_ending", endingId: "end1" },
    });
    expect(() => compileFormSchema(parseFormSchema(schema))).not.toThrow();
  });
});

describe("creator-supplied URLs", () => {
  it("rejects non-web schemes for ending redirects and theme images", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "ftp://example.com/x",
    ]) {
      const withRedirect = baseSchema();
      withRedirect.endings[0].redirectUrl = url;
      expect(() => parseFormSchema(withRedirect), url).toThrow(FormSchemaError);

      const withLogo = baseSchema();
      withLogo.theme = { logoUrl: url };
      expect(() => parseFormSchema(withLogo), url).toThrow(FormSchemaError);
    }
  });

  it("accepts http(s) URLs", () => {
    const schema = baseSchema();
    schema.endings[0].redirectUrl = "https://example.com/thanks?x=1";
    schema.theme = { backgroundImageUrl: "http://example.com/bg.png" };
    expect(() => parseFormSchema(schema)).not.toThrow();
  });
});

describe("describeSchemaProblem", () => {
  it("returns null for a valid schema", () => {
    expect(describeSchemaProblem(baseSchema())).toBeNull();
  });

  it("points at the question by its displayed position, not array index", () => {
    const schema = baseSchema();
    // Array order differs from display order: q2 is shown first.
    schema.questions[0].order = 1;
    schema.questions[1].order = 0;
    schema.questions[0] = {
      id: "q1",
      type: "number",
      order: 1,
      label: "Age",
      settings: { min: 10, max: 5 },
    };
    expect(describeSchemaProblem(schema)).toEqual({
      message: "Question 2: min can't be greater than max",
      questionId: "q1",
    });
  });

  it("uses friendly wording for field-level problems", () => {
    const schema = baseSchema();
    schema.endings[0].redirectUrl = "example.com";
    expect(describeSchemaProblem(schema)).toEqual({
      message:
        "Ending “Thanks!”: redirect URL must be a full address like https://example.com",
      endingId: "end1",
    });
  });

  it("reports dangling logic without exposing internal ids", () => {
    const schema = baseSchema();
    schema.logic = [
      {
        id: "r1",
        questionId: "q1",
        operator: "equals",
        value: "x",
        action: { type: "jump_to_question", questionId: "gone" },
      },
    ];
    expect(describeSchemaProblem(schema)?.message).toMatch(/^Logic rule 1:/);
  });
});

describe("forward-only jumps", () => {
  function withRule(rule: Record<string, unknown>) {
    const schema = baseSchema();
    schema.questions.push({
      id: "q3",
      type: "short_text",
      order: 2,
      label: "Third",
      required: false,
      settings: {},
    });
    schema.logic.push(rule as never);
    return parseFormSchema(schema);
  }
  const jump = (from: string, to: string) => ({
    id: "l1",
    questionId: from,
    operator: "is_answered",
    action: { type: "jump_to_question", questionId: to },
  });

  it("accepts a jump to a later question", () => {
    expect(() => validateSemantics(withRule(jump("q1", "q3")))).not.toThrow();
  });

  it("rejects a jump back to an earlier question", () => {
    expect(() => validateSemantics(withRule(jump("q3", "q2")))).toThrow(
      expect.objectContaining({ code: "backward_jump" }),
    );
  });

  it("rejects a jump to the question itself", () => {
    expect(() => validateSemantics(withRule(jump("q2", "q2")))).toThrow(
      expect.objectContaining({ code: "backward_jump" }),
    );
  });

  it("measures 'earlier' by the order respondents see, not array position", () => {
    const schema = baseSchema();
    schema.questions.reverse(); // array order q2, q1 — but q1.order is 0
    schema.logic.push(jump("q1", "q2") as never);
    expect(() => validateSemantics(parseFormSchema(schema))).not.toThrow();
  });

  it("says which rule is wrong and why, in the creator's terms", () => {
    const schema = baseSchema();
    schema.questions.push({
      id: "q3",
      type: "short_text",
      order: 2,
      label: "Third",
      required: false,
      settings: {},
    });
    schema.logic.push(
      {
        id: "ok",
        questionId: "q1",
        operator: "is_answered",
        action: { type: "jump_to_ending", endingId: "end1" },
      },
      jump("q3", "q1") as never,
    );
    const problem = describeSchemaProblem(schema);
    expect(problem?.message).toMatch(/^Logic rule 2: jumps back/);
    expect(problem?.message).not.toMatch(/q3|q1|rule_/);
  });
});

describe("option references in logic", () => {
  function choice(options: { id: string; label: string }[]) {
    const schema = baseSchema();
    schema.questions.push({
      id: "q_pick",
      type: "single_select",
      order: 2,
      label: "Pick",
      required: false,
      settings: { options },
    } as never);
    return schema;
  }
  const rule = (operator: string, value: unknown) => ({
    id: "r1",
    questionId: "q_pick",
    operator,
    value,
    action: { type: "jump_to_ending", endingId: "end1" },
  });

  it("accepts a rule that checks an option the question has", () => {
    const schema = choice([{ id: "a", label: "A" }]);
    schema.logic.push(rule("equals", "a") as never);
    expect(() => validateSemantics(parseFormSchema(schema))).not.toThrow();
  });

  it("rejects a rule that checks an option that was deleted", () => {
    const schema = choice([{ id: "a", label: "A" }]);
    schema.logic.push(rule("equals", "deleted") as never);
    expect(() => validateSemantics(parseFormSchema(schema))).toThrow(
      expect.objectContaining({ code: "dangling_logic_option" }),
    );
  });

  it("does not check the value of is_answered", () => {
    const schema = choice([{ id: "a", label: "A" }]);
    schema.logic.push(rule("is_answered", undefined) as never);
    expect(() => validateSemantics(parseFormSchema(schema))).not.toThrow();
  });

  it("rejects two options sharing an id", () => {
    const schema = choice([
      { id: "a", label: "A" },
      { id: "a", label: "A again" },
    ]);
    expect(() => validateSemantics(parseFormSchema(schema))).toThrow(
      expect.objectContaining({ code: "duplicate_option_id" }),
    );
  });
});

describe("validateForPublish", () => {
  it("lets a half-built rule be saved as a draft but not published", () => {
    const schema = baseSchema();
    schema.logic.push({
      id: "r1",
      questionId: "q1",
      operator: "equals",
      action: { type: "jump_to_ending", endingId: "end1" },
    });
    const parsed = parseFormSchema(schema);
    expect(() => validateSemantics(parsed)).not.toThrow();
    expect(() => validateForPublish(parsed)).toThrow(
      expect.objectContaining({ code: "incomplete_logic_rule" }),
    );
  });

  it("publishes a complete rule", () => {
    const schema = baseSchema();
    schema.logic.push({
      id: "r1",
      questionId: "q1",
      operator: "equals",
      value: "yes",
      action: { type: "jump_to_ending", endingId: "end1" },
    });
    expect(() => validateForPublish(parseFormSchema(schema))).not.toThrow();
  });
});
