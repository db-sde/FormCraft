import { describe, expect, it } from "vitest";
import { assessHealth, type HealthSnapshot } from "@/domains/observability/health";

const quiet = { overdue: 0, oldestOverdueMinutes: 0, exhaustedLast24h: 0 };
const healthy: HealthSnapshot = { webhooks: quiet, sheets: quiet, stuckUploads: 0 };

describe("assessHealth", () => {
  it("is ok when nothing is late", () => {
    const report = assessHealth(healthy);
    expect(report.status).toBe("ok");
    expect(report.problems).toEqual([]);
  });

  it("is degraded when retries are overdue — our sweep stopped", () => {
    const report = assessHealth({
      ...healthy,
      webhooks: { overdue: 3, oldestOverdueMinutes: 95, exhaustedLast24h: 0 },
    });
    expect(report.status).toBe("degraded");
    expect(report.problems[0]).toMatch(
      /3 webhook deliverys? overdue by up to 95 minutes/,
    );
  });

  it("says which queue is behind", () => {
    const report = assessHealth({
      ...healthy,
      sheets: { overdue: 1, oldestOverdueMinutes: 20, exhaustedLast24h: 0 },
    });
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatch(/Google Sheets sync/);
  });

  it("is degraded for uploads stuck half-finished", () => {
    expect(assessHealth({ ...healthy, stuckUploads: 2 }).status).toBe("degraded");
  });

  it("reports jobs that gave up without calling it an outage", () => {
    // A creator's endpoint being down is theirs to fix, not ours.
    const report = assessHealth({
      ...healthy,
      webhooks: { overdue: 0, oldestOverdueMinutes: 0, exhaustedLast24h: 7 },
    });
    expect(report.status).toBe("ok");
    expect(report.webhooks.exhaustedLast24h).toBe(7);
  });
});
