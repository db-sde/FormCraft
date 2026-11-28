import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  admin,
  canRunLocally,
  clearStaff,
  person,
  sql,
  staffTeam,
  type Person,
} from "./staff-helpers";

/**
 * The staff portal's "Send test error" (migration 87): only staff who may
 * record operations work can send one, and each is in the audit trail
 * with the id the Sentry event carries.
 */
const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
const describeLocal = canRunLocally ? describe : describe.skip;

describeLocal("Sentry test error from the staff portal", () => {
  let owner: Person;
  let support: Person;
  let customer: Person;

  beforeAll(async () => {
    owner = await person("sentry-owner", runId, { mfa: true });
    support = await person("sentry-support", runId, { mfa: true });
    customer = await person("sentry-customer", runId, { mfa: true });
    await staffTeam(owner, [{ person: support, role: "support" }]);
  });

  afterAll(async () => {
    if (!canRunLocally) return;
    clearStaff();
    for (const p of [owner, support, customer])
      if (p) await admin.auth.admin.deleteUser(p.id);
  });

  const id = () => crypto.randomUUID().replace(/-/g, "");

  it("logs the owner's test with its event id", async () => {
    const eventId = id();
    expect(await call(owner, "admin_log_sentry_test", { p_event_id: eventId })).toEqual({
      ok: true,
    });
    expect(
      sql(`select action || ' ' || outcome || ' ' || target_type from private.platform_audit_log
            where target_id = '${eventId}';`),
    ).toBe("ops.sentry_test_sent succeeded sentry_event");
  });

  it("refuses staff without ops.record, and customers", async () => {
    for (const p of [support, customer]) {
      const eventId = id();
      const r = await call(p, "admin_log_sentry_test", { p_event_id: eventId });
      expect(r.ok).toBe(false);
      expect(
        sql(`select count(*) from private.platform_audit_log
              where target_id = '${eventId}' and outcome = 'succeeded';`),
      ).toBe("0");
    }
  });

  it("only takes a Sentry event id", async () => {
    for (const bad of ["", "not-an-id", `${id()}x`, "'; drop table x; --"]) {
      expect(await call(owner, "admin_log_sentry_test", { p_event_id: bad })).toEqual({
        ok: false,
        code: "invalid",
      });
    }
  });
});
