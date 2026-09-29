import { describe, expect, it } from "vitest";
import {
  parseFormSchema,
  validateSemantics,
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

  it("allows a backward jump (go-back logic) because the default forward edge is always a possible escape", () => {
    const schema = baseSchema();
    schema.questions.push({
      id: "q3",
      type: "short_text",
      order: 2,
      label: "Loop target",
      required: false,
      settings: {},
    });
    // q3 can conditionally jump back to q2, but q3's unconditional
    // default edge (used whenever the condition doesn't match) always
    // reaches the ending, so the compiler must not flag this as an
    // inescapable loop.
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
    expect(describeSchemaProblem(schema)?.message).toMatch(/^Logic:/);
  });
});
