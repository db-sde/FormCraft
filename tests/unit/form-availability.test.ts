import { describe, expect, it } from "vitest";
import {
  availabilityOf,
  DEFAULT_CLOSED_MESSAGE,
  DEFAULT_FULL_MESSAGE,
  refusalMessage,
  type AvailabilitySettings,
} from "@/domains/forms/availability";

const open: AvailabilitySettings = {
  closesAt: null,
  closedMessage: null,
  responseCap: null,
  fullMessage: null,
};
const now = new Date("2026-10-28T12:00:00Z");

describe("form availability (F-46 close date, F-47 response cap)", () => {
  it("is open with no date and no cap, however many responses there are", () => {
    expect(availabilityOf(open, 1_000_000, now)).toEqual({ open: true });
  });

  it("closes at the exact closing instant, not a moment later", () => {
    const settings = { ...open, closesAt: "2026-10-28T12:00:00Z" };
    expect(availabilityOf(settings, 0, new Date("2026-10-28T11:59:59.999Z")).open).toBe(
      true,
    );
    expect(availabilityOf(settings, 0, now)).toEqual({
      open: false,
      reason: "closed",
      message: DEFAULT_CLOSED_MESSAGE,
    });
  });

  it("compares instants, so the closing time's offset doesn't matter", () => {
    // 17:30 in India is 12:00 UTC.
    const settings = { ...open, closesAt: "2026-10-28T17:30:00+05:30" };
    expect(availabilityOf(settings, 0, now).open).toBe(false);
    expect(availabilityOf(settings, 0, new Date("2026-10-28T11:59:00Z")).open).toBe(true);
  });

  it("fills up when accepted responses reach the cap", () => {
    const settings = { ...open, responseCap: 3 };
    expect(availabilityOf(settings, 2, now).open).toBe(true);
    expect(availabilityOf(settings, 3, now)).toEqual({
      open: false,
      reason: "full",
      message: DEFAULT_FULL_MESSAGE,
    });
  });

  it("gives the deadline as the reason when the form is both closed and full", () => {
    const settings = { ...open, closesAt: "2026-10-01T00:00:00Z", responseCap: 1 };
    expect(availabilityOf(settings, 5, now)).toMatchObject({ reason: "closed" });
  });

  it("uses the creator's own message, trimmed, and the default for a blank one", () => {
    expect(
      availabilityOf(
        { ...open, responseCap: 1, fullMessage: "  All seats taken.  " },
        1,
        now,
      ),
    ).toMatchObject({ message: "All seats taken." });
    expect(
      availabilityOf(
        { ...open, closesAt: now.toISOString(), closedMessage: "   " },
        0,
        now,
      ),
    ).toMatchObject({ message: DEFAULT_CLOSED_MESSAGE });
    expect(refusalMessage("full", { closedMessage: null, fullMessage: "Sold out" })).toBe(
      "Sold out",
    );
    expect(refusalMessage("closed", { closedMessage: null, fullMessage: "x" })).toBe(
      DEFAULT_CLOSED_MESSAGE,
    );
  });
});
