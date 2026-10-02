import { describe, expect, it } from "vitest";
import { parseFormSchema } from "@/domains/forms/schema";
import { summarizeOutcomes } from "@/domains/responses/summary";

const schema = parseFormSchema({
  schemaVersion: 1,
  meta: { title: "Quiz" },
  theme: {},
  endings: [
    { id: "low", title: "Keep practising", isDefault: true },
    { id: "high", title: "Expert, {{answer:q1}}", isDefault: false },
  ],
  questions: [{ id: "q1", type: "short_text", order: 0, label: "Q", settings: {} }],
  logic: [],
  variables: [
    { id: "v_score", name: "score", type: "number" },
    { id: "v_segment", name: "segment", type: "string" },
    { id: "v_tags", name: "tags", type: "list" },
  ],
});

describe("summarizeOutcomes", () => {
  it("counts endings and summarises each variable by type", () => {
    const outcomes = summarizeOutcomes(schema, [
      {
        endingId: "high",
        variables: { v_score: 9, v_segment: "pro", v_tags: ["a", "b"] },
      },
      { endingId: "high", variables: { v_score: 7, v_segment: "pro", v_tags: ["a"] } },
      { endingId: "low", variables: { v_score: 2, v_segment: "", v_tags: [] } },
      { endingId: "gone", variables: { v_score: null } },
    ]);

    expect(outcomes.endings).toEqual([
      { endingId: "high", title: "Expert, [Q]", count: 2, percent: 50 },
      { endingId: "low", title: "Keep practising", count: 1, percent: 25 },
      { endingId: "gone", title: "A removed ending", count: 1, percent: 25 },
    ]);
    const [score, segment, tags] = outcomes.variables;
    expect(score).toEqual({
      variableId: "v_score",
      name: "score",
      kind: "number",
      count: 3,
      average: 6,
      min: 2,
      max: 9,
    });
    expect(segment).toMatchObject({
      kind: "values",
      count: 2,
      bars: [{ label: "pro", count: 2, percent: 100 }],
    });
    // Lists count each item.
    expect(tags).toMatchObject({
      kind: "values",
      bars: [
        { label: "a", count: 2 },
        { label: "b", count: 1 },
      ],
    });
  });

  it("is empty for a form with no responses", () => {
    const outcomes = summarizeOutcomes(schema, []);
    expect(outcomes.endings).toEqual([]);
    expect(outcomes.variables.map((v) => v.count)).toEqual([0, 0, 0]);
  });
});
