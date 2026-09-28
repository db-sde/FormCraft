import { describe, expect, it } from "vitest";
import {
  computeCompletionRate,
  computeFunnelSummary,
} from "@/domains/analytics/completion-rate";

describe("computeCompletionRate", () => {
  it("returns null when there are no valid starts", () => {
    expect(computeCompletionRate([])).toBeNull();
  });

  it("computes completions / starts * 100, not submissions / views", () => {
    const events = [
      { eventType: "form_viewed", isPreview: false },
      { eventType: "form_viewed", isPreview: false },
      { eventType: "form_started", isPreview: false },
      { eventType: "form_started", isPreview: false },
      { eventType: "form_submitted", isPreview: false },
    ];
    expect(computeCompletionRate(events)).toBe(50);
  });

  it("excludes preview traffic from the calculation", () => {
    const events = [
      { eventType: "form_started", isPreview: false },
      { eventType: "form_submitted", isPreview: false },
      { eventType: "form_started", isPreview: true },
      { eventType: "form_started", isPreview: true },
      { eventType: "form_started", isPreview: true },
    ];
    expect(computeCompletionRate(events)).toBe(100);
  });
});

describe("computeFunnelSummary", () => {
  it("reports null completion rate with zero starts, not 0%", () => {
    const summary = computeFunnelSummary([
      { eventType: "form_viewed", isPreview: false },
    ]);
    expect(summary.views).toBe(1);
    expect(summary.starts).toBe(0);
    expect(summary.completionRate).toBeNull();
  });
});
