import { describe, expect, it } from "vitest";
import { parseFormSchema, validateSemantics } from "@/domains/forms/schema";
import {
  endingReferences,
  jumpsBrokenByReorder,
  questionReferences,
  removeEndingReferences,
  removeQuestionReferences,
  rulesBrokenByOptionChange,
} from "@/domains/forms/references";

const schema = parseFormSchema({
  schemaVersion: 1,
  meta: { title: "t" },
  theme: {},
  endings: [
    { id: "end", title: "Thanks", isDefault: true },
    { id: "alt", title: "Alt" },
  ],
  questions: [
    {
      id: "q1",
      type: "single_select",
      order: 0,
      label: "Q1",
      settings: {
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
    },
    {
      id: "q2",
      type: "short_text",
      order: 1,
      label: "Q2",
      settings: {},
      visibleIf: {
        type: "compare",
        left: { type: "answer", questionId: "q1" },
        op: "eq",
        right: { type: "literal", value: "a" },
      },
    },
    { id: "q3", type: "short_text", order: 2, label: "Q3", settings: {} },
  ],
  // A legacy rule…
  logic: [
    {
      id: "legacy",
      questionId: "q1",
      operator: "equals",
      value: "b",
      action: { type: "jump_to_ending", endingId: "alt" },
    },
  ],
  // …and a new one.
  rules: [
    {
      id: "jump",
      on: { event: "question_answered", questionId: "q2" },
      then: [{ type: "jump_to_question", questionId: "q3" }],
    },
  ],
});

describe("form references", () => {
  it("finds legacy rules, rules and show conditions that use a question", () => {
    expect(questionReferences(schema, "q1")).toEqual({
      ruleIds: ["legacy"],
      questionIds: ["q2"],
    });
    expect(questionReferences(schema, "q3").ruleIds).toEqual(["jump"]);
  });

  it("removes them so the draft stays valid", () => {
    const next = removeQuestionReferences(
      { ...schema, questions: schema.questions.filter((q) => q.id !== "q1") },
      "q1",
    );
    expect(next.logic).toEqual([]);
    expect(next.questions.find((q) => q.id === "q2")?.visibleIf).toBeUndefined();
    expect(() => validateSemantics(next)).not.toThrow();
  });

  it("handles endings", () => {
    expect(endingReferences(schema, "alt")).toEqual(["legacy"]);
    expect(removeEndingReferences(schema, "alt").logic).toEqual([]);
  });

  it("finds rules broken by removing an option", () => {
    expect(rulesBrokenByOptionChange(schema, "q1", new Set(["a"]))).toEqual(["legacy"]);
    expect(rulesBrokenByOptionChange(schema, "q1", new Set(["a", "b"]))).toEqual([]);
  });

  it("refuses a reorder that turns a jump backwards", () => {
    const swapped = schema.questions.map((q) =>
      q.id === "q2" ? { ...q, order: 2 } : q.id === "q3" ? { ...q, order: 1 } : q,
    );
    expect(jumpsBrokenByReorder(schema, swapped)).toEqual(["jump"]);
    expect(jumpsBrokenByReorder(schema, schema.questions)).toEqual([]);
  });
});
