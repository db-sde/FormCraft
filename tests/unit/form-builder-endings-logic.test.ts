import { describe, expect, it } from "vitest";
import {
  createEnding,
  canDeleteEnding,
  removeEnding,
  setDefaultEnding,
  createLogicRule,
  removeLogicRule,
  rulesReferencingQuestion,
  rulesReferencingEnding,
} from "@/domains/forms/builder";
import type { EndingV1, LogicRuleV1 } from "@/domains/forms/schema/v1";

function twoEndings(): EndingV1[] {
  return [
    { id: "end_default", title: "Thanks", isDefault: true },
    { id: "end_other", title: "Also thanks", isDefault: false },
  ];
}

describe("endings", () => {
  it("creates a non-default ending with a unique id", () => {
    const a = createEnding();
    const b = createEnding();
    expect(a.isDefault).toBe(false);
    expect(a.id).not.toBe(b.id);
  });

  it("refuses to delete the default ending", () => {
    const endings = twoEndings();
    expect(canDeleteEnding(endings, "end_default")).toBe(false);
    expect(removeEnding(endings, "end_default")).toEqual(endings);
  });

  it("refuses to delete the last remaining ending even if not default", () => {
    const endings: EndingV1[] = [{ id: "only", title: "Thanks", isDefault: false }];
    expect(canDeleteEnding(endings, "only")).toBe(false);
  });

  it("allows deleting a non-default ending when another remains", () => {
    const endings = twoEndings();
    expect(canDeleteEnding(endings, "end_other")).toBe(true);
    expect(removeEnding(endings, "end_other")).toEqual([endings[0]]);
  });

  it("setDefaultEnding moves the default flag and never leaves zero or two defaults", () => {
    const endings = twoEndings();
    const result = setDefaultEnding(endings, "end_other");
    expect(result.filter((e) => e.isDefault)).toHaveLength(1);
    expect(result.find((e) => e.id === "end_other")?.isDefault).toBe(true);
    expect(result.find((e) => e.id === "end_default")?.isDefault).toBe(false);
  });
});

describe("logic rules", () => {
  it("creates a rule defaulting to is_answered", () => {
    const rule = createLogicRule("q1", {
      type: "jump_to_ending",
      endingId: "end_default",
    });
    expect(rule.questionId).toBe("q1");
    expect(rule.operator).toBe("is_answered");
    expect(rule.action).toEqual({ type: "jump_to_ending", endingId: "end_default" });
  });

  it("removeLogicRule filters by id", () => {
    const rules: LogicRuleV1[] = [
      createLogicRule("q1", { type: "jump_to_ending", endingId: "e" }),
      createLogicRule("q2", { type: "jump_to_ending", endingId: "e" }),
    ];
    const result = removeLogicRule(rules, rules[0].id);
    expect(result).toEqual([rules[1]]);
  });

  it("rulesReferencingQuestion finds rules sourced from AND jumping to the question", () => {
    const sourced = createLogicRule("q1", { type: "jump_to_ending", endingId: "e" });
    const targeting = createLogicRule("q2", {
      type: "jump_to_question",
      questionId: "q1",
    });
    const unrelated = createLogicRule("q3", { type: "jump_to_ending", endingId: "e" });
    const result = rulesReferencingQuestion([sourced, targeting, unrelated], "q1");
    expect(result).toEqual([sourced, targeting]);
  });

  it("rulesReferencingEnding finds rules that jump to the ending", () => {
    const targeting = createLogicRule("q1", {
      type: "jump_to_ending",
      endingId: "end_x",
    });
    const unrelated = createLogicRule("q2", {
      type: "jump_to_ending",
      endingId: "end_y",
    });
    expect(rulesReferencingEnding([targeting, unrelated], "end_x")).toEqual([targeting]);
  });
});
