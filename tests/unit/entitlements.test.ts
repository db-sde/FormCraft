import { describe, expect, it } from "vitest";
import {
  ENTITLEMENT_DEFAULTS,
  resolveEntitlements,
  withinLimit,
} from "@/domains/billing/entitlements";
import { currentPeriodStart, usageWarnings, type Usage } from "@/domains/billing/usage";

describe("resolveEntitlements", () => {
  it("layers plan values over defaults and overrides over both", () => {
    const e = resolveEntitlements(
      { members: 10, remove_branding: true, responses_per_month: null },
      { members: 25 },
    );
    expect(e.members).toBe(25);
    expect(e.remove_branding).toBe(true);
    expect(e.responses_per_month).toBeNull();
    expect(e.payments).toBe(ENTITLEMENT_DEFAULTS.payments);
  });

  it("ignores unknown keys and values of the wrong type", () => {
    const e = resolveEntitlements(
      { members: "lots", remove_branding: "yes", upload_mb: -5, secret: true },
      null,
    );
    expect(e).toEqual(ENTITLEMENT_DEFAULTS);
    expect(e).not.toHaveProperty("secret");
  });
});

describe("withinLimit", () => {
  it("treats null as unlimited and counts what's being added", () => {
    const e = resolveEntitlements({ members: 3, responses_per_month: null }, {});
    expect(withinLimit(e, "members", 2)).toBe(true);
    expect(withinLimit(e, "members", 3)).toBe(false);
    expect(withinLimit(e, "members", 1, 3)).toBe(false);
    expect(withinLimit(e, "responses_per_month", 1e9)).toBe(true);
  });
});

describe("usage", () => {
  it("periods start on the 1st, in UTC", () => {
    expect(currentPeriodStart(new Date("2026-03-31T23:30:00-05:00"))).toBe("2026-04-01");
    expect(currentPeriodStart(new Date("2026-12-05T00:00:00Z"))).toBe("2026-12-01");
  });

  it("warns past a limit and never before it", () => {
    const usage: Usage = {
      periodStart: "2026-10-01",
      completedResponses: 1001,
      aiCredits: 0,
      members: 1,
      storageMb: 10,
    };
    const e = resolveEntitlements({ responses_per_month: 1000, storage_mb: 10 }, {});
    expect(usageWarnings(usage, e).map((w) => w.metric)).toEqual(["responses"]);
    expect(usageWarnings({ ...usage, completedResponses: 1000 }, e)).toEqual([]);
    expect(
      usageWarnings(usage, resolveEntitlements({ responses_per_month: null }, {})),
    ).toEqual([]);
  });
});
