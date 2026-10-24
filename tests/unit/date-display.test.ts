import { describe, expect, it } from "vitest";
import { displayDate } from "@/domains/logic/validate-answer";

// QA FC-18: a date limit in an error reads like the date field.
describe("displayDate", () => {
  it("uses the locale's numeric date format", () => {
    expect(displayDate("2026-11-22", "en-US")).toBe("11/22/2026");
    expect(displayDate("2026-11-22", "en-GB")).toBe("22/11/2026");
  });

  it("never shifts the day with the time zone", () => {
    expect(displayDate("2026-01-01", "en-US")).toBe("01/01/2026");
  });
});
