import { describe, expect, it } from "vitest";
import { buildInsights, type InsightDropoffStep } from "@/domains/analytics/insights";

const step = (id: string, stopped: number, required = false): InsightDropoffStep => ({
  questionId: id,
  label: id.toUpperCase(),
  required,
  stopped,
});

describe("conversion insights", () => {
  it("says there isn't enough data below the minimum sample", () => {
    const insights = buildInsights({
      steps: [step("a", 2, true), step("b", 1)],
      sources: [{ source: "Direct", started: 4, completed: 1 }],
    });
    expect(insights.map((i) => i.id)).toEqual(["not-enough-data"]);
  });

  it("names the bottleneck question, and says when it's required", () => {
    const insights = buildInsights({
      steps: [
        step("name", 1),
        step("phone", 6, true),
        step("email", 1),
        step("notes", 2),
      ],
      sources: [],
    });
    expect(insights[0]).toMatchObject({
      id: "dropoff:phone",
      tone: "warning",
      title: "60% of people who leave stop at “PHONE”",
    });
    expect(insights[0].detail).toContain("required");
  });

  it("flags required questions that lose more than their share", () => {
    const insights = buildInsights({
      steps: [
        step("a", 3, true),
        step("b", 3, true),
        step("c", 1),
        step("d", 1),
        step("e", 2),
      ],
      sources: [],
    });
    expect(insights.find((i) => i.id === "dropoff:required")?.title).toBe(
      "60% of drop-offs happen at required questions",
    );
    // When every question is required, that's not news.
    const all = buildInsights({
      steps: [step("a", 3, true), step("b", 3, true)],
      sources: [],
    });
    expect(all.some((i) => i.id === "dropoff:required")).toBe(false);
  });

  it("compares traffic sources only once each has enough starts", () => {
    const insights = buildInsights({
      steps: [],
      sources: [
        { source: "newsletter", started: 20, completed: 18 },
        { source: "twitter.com", started: 40, completed: 8 },
        { source: "Direct", started: 40, completed: 20 },
        // Too small to judge, however good it looks.
        { source: "tiny", started: 3, completed: 3 },
      ],
    });
    expect(insights.map((i) => i.id)).toEqual([
      "source:best:newsletter",
      "source:worst:twitter.com",
    ]);
    expect(insights[0].detail).toBe(
      "18 of 20 people from newsletter finished, against 48% overall.",
    );
  });

  it("says nothing stands out when the data is even", () => {
    const insights = buildInsights({
      steps: [step("a", 3), step("b", 3), step("c", 2), step("d", 2), step("e", 2)],
      sources: [
        { source: "Direct", started: 20, completed: 10 },
        { source: "x.com", started: 20, completed: 11 },
      ],
    });
    expect(insights.map((i) => i.id)).toEqual(["none"]);
  });
});
