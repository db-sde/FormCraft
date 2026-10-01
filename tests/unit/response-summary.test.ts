import { describe, expect, it } from "vitest";
import { summarizeAnswers } from "@/domains/responses/summary";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";

const questions: QuestionV1[] = [
  {
    id: "w",
    type: "welcome_screen",
    order: 0,
    label: "Hi",
    required: false,
    settings: {},
  },
  {
    id: "color",
    type: "multi_select",
    order: 1,
    label: "Colours",
    required: false,
    settings: {
      options: [
        { id: "red", label: "Red" },
        { id: "blue", label: "Blue" },
      ],
      allowOther: true,
    },
  },
  {
    id: "nps",
    type: "opinion_scale",
    order: 2,
    label: "Recommend us?",
    required: false,
    settings: { min: 0, max: 10 },
  },
  {
    id: "stars",
    type: "rating",
    order: 3,
    label: "Rate it",
    required: false,
    settings: { scale: 5 },
  },
  {
    id: "notes",
    type: "long_text",
    order: 4,
    label: "Anything else?",
    required: false,
    settings: {},
  },
  {
    id: "ok",
    type: "yes_no",
    order: 5,
    label: "Happy?",
    required: false,
    settings: {},
  },
] as QuestionV1[];

const schema = {
  schemaVersion: 1,
  meta: { title: "Test" },
  theme: {},
  endings: [],
  logic: [],
  questions,
} as unknown as FormSchemaV1;

const answers = (rows: Record<string, unknown>[]) =>
  rows.map((r) => new Map(Object.entries(r)));

describe("summarizeAnswers", () => {
  const result = summarizeAnswers(
    schema,
    answers([
      { color: ["red", "blue"], nps: 10, stars: 4, notes: "Newest", ok: true },
      { color: ["red"], nps: 9, stars: 5, notes: "Second", ok: false },
      { color: ["other:Teal"], nps: 3, notes: "Third" },
      { nps: 7, notes: "Fourth", ok: true },
    ]),
  );
  const byId = Object.fromEntries(result.map((q) => [q.questionId, q]));

  it("numbers questions as respondents see them, skipping the welcome screen", () => {
    expect(result.map((q) => q.number)).toEqual([1, 2, 3, 4, 5]);
  });

  it("counts each chosen option, including Other, as a share of answerers", () => {
    const color = byId.color;
    expect(color.kind).toBe("choice");
    if (color.kind !== "choice") return;
    expect(color.answered).toBe(3);
    expect(color.bars).toEqual([
      { label: "Red", count: 2, percent: 67 },
      { label: "Blue", count: 1, percent: 33 },
      { label: "Other", count: 1, percent: 33 },
    ]);
  });

  it("works out NPS for a 0–10 scale", () => {
    const nps = byId.nps;
    if (nps.kind !== "scale") throw new Error("expected a scale summary");
    // 2 promoters (9, 10) and 1 detractor (3) out of 4.
    expect(nps.nps).toEqual({ score: 25, promoters: 50, detractors: 25 });
    expect(nps.counts).toHaveLength(11);
  });

  it("averages ratings over the people who answered", () => {
    const stars = byId.stars;
    if (stars.kind !== "rating") throw new Error("expected a rating summary");
    expect(stars.answered).toBe(2);
    expect(stars.average).toBe(4.5);
  });

  it("quotes the newest text answers first", () => {
    const notes = byId.notes;
    if (notes.kind !== "text") throw new Error("expected a text summary");
    expect(notes.quotes).toEqual(["Newest", "Second", "Third"]);
    expect(notes.answered).toBe(4);
  });

  it("splits yes/no answers", () => {
    const ok = byId.ok;
    if (ok.kind !== "choice") throw new Error("expected a choice summary");
    expect(ok.bars.map((b) => [b.label, b.count])).toEqual([
      ["Yes", 2],
      ["No", 1],
    ]);
  });
});
