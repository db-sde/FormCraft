import { describe, expect, it } from "vitest";
import { analyzeLogic, compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import {
  answerUsesAvailableOptions,
  availableOptionIds,
  syncCarriedOptions,
} from "@/domains/forms/options";
import { removeQuestionReferences } from "@/domains/forms/references";
import { walkForm } from "@/domains/logic";

const base = parseFormSchema({
  schemaVersion: 1,
  meta: { title: "Tools" },
  theme: {},
  endings: [{ id: "end", title: "Done", isDefault: true }],
  questions: [
    {
      id: "used",
      type: "multi_select",
      order: 0,
      label: "Which tools do you use?",
      required: true,
      settings: {
        options: [
          { id: "slack", label: "Slack", scores: [{ variableId: "v", points: 5 }] },
          { id: "jira", label: "Jira" },
          { id: "figma", label: "Figma" },
        ],
      },
    },
    {
      id: "fav",
      type: "single_select",
      order: 1,
      label: "Which matters most?",
      required: true,
      settings: {
        options: [{ id: "placeholder", label: "x" }],
        optionsFrom: { questionId: "used", include: "selected" },
      },
    },
    { id: "last", type: "short_text", order: 2, label: "Anything else?", settings: {} },
  ],
  logic: [],
  variables: [{ id: "v", name: "score", type: "number" }],
});
const schema = syncCarriedOptions(base);
const fav = () => schema.questions.find((q) => q.id === "fav")!;

describe("syncCarriedOptions", () => {
  it("copies the source's ids and labels, not its points", () => {
    expect((fav().settings as { options: unknown[] }).options).toEqual([
      { id: "slack", label: "Slack" },
      { id: "jira", label: "Jira" },
      { id: "figma", label: "Figma" },
    ]);
    // Already in sync: same object back.
    expect(syncCarriedOptions(schema)).toBe(schema);
    expect(analyzeLogic(schema)).toEqual([]);
  });

  it("is required: an out-of-date copy is an error", () => {
    expect(analyzeLogic(base).map((i) => i.code)).toContain("options_from_out_of_sync");
  });
});

describe("what a respondent is offered", () => {
  it("only what they picked (or didn't)", () => {
    expect([...availableOptionIds(fav(), { used: ["jira", "figma"] })!]).toEqual([
      "jira",
      "figma",
    ]);
    const notPicked = {
      ...fav(),
      settings: {
        ...fav().settings,
        optionsFrom: { questionId: "used", include: "not_selected" },
      },
    } as typeof fav extends () => infer Q ? Q : never;
    expect([...availableOptionIds(notPicked, { used: ["jira"] })!]).toEqual([
      "slack",
      "figma",
    ]);
    expect(answerUsesAvailableOptions(fav(), "slack", { used: ["jira"] })).toBe(false);
    expect(answerUsesAvailableOptions(fav(), "jira", { used: ["jira"] })).toBe(true);
  });

  it("skips the question when nothing applies", () => {
    const compiled = compileFormSchema(schema);
    expect(walkForm(compiled, { used: [], last: "x" }).visitedQuestionIds).toEqual([
      "used",
      "last",
    ]);
    expect(
      walkForm(compiled, { used: ["jira"], fav: "jira", last: "x" }).visitedQuestionIds,
    ).toEqual(["used", "fav", "last"]);
  });
});

describe("when the source goes", () => {
  it("leaves the dependent with its options as its own", () => {
    const next = removeQuestionReferences(
      { ...schema, questions: schema.questions.filter((q) => q.id !== "used") },
      "used",
    );
    const dependent = next.questions.find((q) => q.id === "fav")!;
    expect(dependent.settings).not.toHaveProperty("optionsFrom");
    expect((dependent.settings as { options: unknown[] }).options).toHaveLength(3);
    expect(analyzeLogic(next)).toEqual([]);
  });

  it("can't come from a later question", () => {
    const later = parseFormSchema({
      ...schema,
      questions: schema.questions.map((q) => (q.id === "used" ? { ...q, order: 5 } : q)),
    });
    expect(analyzeLogic(later).map((i) => i.code)).toContain("options_from_later");
  });
});
