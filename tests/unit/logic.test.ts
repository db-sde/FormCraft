import { describe, expect, it } from "vitest";
import { compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import { evaluateNextStep, walkForm } from "@/domains/logic";
import { z } from "zod";
import { FormSchemaV1 as FormSchemaV1Zod } from "@/domains/forms/schema/v1";

function schema(): z.input<typeof FormSchemaV1Zod> {
  return {
    schemaVersion: 1,
    meta: { title: "Branching form" },
    theme: {},
    endings: [
      { id: "default_end", title: "Thanks", isDefault: true },
      { id: "vip_end", title: "VIP thanks" },
    ],
    questions: [
      {
        id: "q_role",
        type: "single_select",
        order: 0,
        label: "Role",
        required: true,
        settings: {
          options: [
            { id: "opt_eng", label: "Engineer" },
            { id: "opt_pm", label: "PM" },
          ],
        },
      },
      {
        id: "q_years",
        type: "number",
        order: 1,
        label: "Years",
        required: true,
        settings: {},
      },
      {
        id: "q_feedback",
        type: "long_text",
        order: 2,
        label: "Feedback",
        required: false,
        settings: {},
      },
    ],
    logic: [
      {
        id: "rule1",
        questionId: "q_role",
        operator: "equals",
        value: "opt_pm",
        action: { type: "jump_to_ending", endingId: "vip_end" },
      },
    ],
  };
}

function compiled() {
  return compileFormSchema(parseFormSchema(schema()));
}

describe("evaluateNextStep", () => {
  it("follows the default order when no rule matches", () => {
    const c = compiled();
    const next = evaluateNextStep(c, "q_role", { q_role: "opt_eng" });
    expect(next).toEqual({ type: "question", questionId: "q_years" });
  });

  it("follows a matching logic rule to jump to an ending", () => {
    const c = compiled();
    const next = evaluateNextStep(c, "q_role", { q_role: "opt_pm" });
    expect(next).toEqual({ type: "ending", endingId: "vip_end" });
  });

  it("reaches the default ending after the last question", () => {
    const c = compiled();
    const next = evaluateNextStep(c, "q_feedback", {});
    expect(next).toEqual({ type: "ending", endingId: "default_end" });
  });
});

describe("walkForm", () => {
  it("is deterministic and matches evaluateNextStep step by step", () => {
    const c = compiled();
    const result = walkForm(c, { q_role: "opt_eng", q_years: 5 });
    expect(result.visitedQuestionIds).toEqual(["q_role", "q_years", "q_feedback"]);
    expect(result.endingId).toBe("default_end");
  });

  it("short-circuits to the branch ending without visiting later questions", () => {
    const c = compiled();
    const result = walkForm(c, { q_role: "opt_pm" });
    expect(result.visitedQuestionIds).toEqual(["q_role"]);
    expect(result.endingId).toBe("vip_end");
  });
});
