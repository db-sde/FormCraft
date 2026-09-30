import { describe, expect, it } from "vitest";
import {
  ABANDONED_AFTER_MINUTES,
  describeSource,
  formatDuration,
  responseActivity,
} from "@/domains/responses/activity";

const now = new Date("2026-09-30T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

describe("responseActivity", () => {
  it("is in progress until the threshold, abandoned from it", () => {
    expect(ABANDONED_AFTER_MINUTES).toBe(30);
    expect(
      responseActivity({ status: "partial", lastActiveAt: minutesAgo(29) }, now),
    ).toBe("in_progress");
    expect(
      responseActivity({ status: "partial", lastActiveAt: minutesAgo(30) }, now),
    ).toBe("abandoned");
    expect(
      responseActivity({ status: "in_progress", lastActiveAt: minutesAgo(600) }, now),
    ).toBe("abandoned");
  });

  it("never marks a completed response abandoned", () => {
    expect(
      responseActivity({ status: "completed", lastActiveAt: minutesAgo(9999) }, now),
    ).toBe("completed");
  });
});

describe("formatDuration", () => {
  it("formats minutes, hours and days", () => {
    const start = "2026-09-30T10:00:00Z";
    expect(formatDuration(start, "2026-09-30T10:00:20Z")).toBe("under a minute");
    expect(formatDuration(start, "2026-09-30T10:07:00Z")).toBe("7 min");
    expect(formatDuration(start, "2026-09-30T11:20:00Z")).toBe("1 h 20 min");
    expect(formatDuration(start, "2026-10-02T14:00:00Z")).toBe("2 d 4 h");
  });
});

describe("describeSource", () => {
  it("prefers the campaign source, then the referrer host, then Direct", () => {
    expect(describeSource({ utmSource: "linkedin", referrer: "https://x.com" })).toBe(
      "linkedin",
    );
    expect(describeSource({ referrer: "https://www.google.com/search?q=a" })).toBe(
      "google.com",
    );
    expect(describeSource({})).toBe("Direct");
  });
});
