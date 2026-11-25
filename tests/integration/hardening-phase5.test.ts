import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  call,
  canRunLocally,
  clearStaff,
  person,
  sql,
  staffTeam,
  type Person,
} from "./staff-helpers";

/**
 * Super Admin Phase 5 (migration 76) against the real database: owners
 * hear about a staff sign-in from a new address and about every
 * high-risk change carried out; the monthly access review is recorded
 * and reminded; drills are recorded; a missing restore drill alerts.
 */
const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
const describeLocal = canRunLocally ? describe : describe.skip;

const open = (pattern: string) =>
  sql(
    `select coalesce(string_agg(kind || '|' || severity || '|' || message, E'\\n'), '') from private.ops_alerts where resolved_at is null and kind like '${pattern}'`,
  );

describeLocal("Super Admin Phase 5: hardening", () => {
  let owner: Person;
  let adminStaff: Person;
  let support: Person;
  const people: Person[] = [];

  beforeAll(async () => {
    owner = await person("h5-owner", runId, { mfa: true });
    adminStaff = await person("h5-admin", runId, { mfa: true });
    support = await person("h5-support", runId, { mfa: true });
    people.push(owner, adminStaff, support);
    sql(
      "delete from private.ops_alerts; delete from private.access_reviews; delete from private.ops_drills;",
    );
    await staffTeam(owner, [
      { person: adminStaff, role: "admin" },
      { person: support, role: "support" },
    ]);
  }, 90_000);

  afterAll(async () => {
    if (!canRunLocally) return;
    sql(
      "delete from private.ops_alerts; delete from private.access_reviews; delete from private.ops_drills; update private.ai_settings set max_tokens = null where feature = 'form_review';",
    );
    clearStaff();
    for (const p of people) await admin.auth.admin.deleteUser(p.id);
  });

  it("tells owners when a staff member signs in from a new address, once", async () => {
    sql(`update auth.sessions set ip = '198.51.100.1' where user_id = '${support.id}';`);
    expect((await call(support, "admin_whoami")).ok).toBe(true);
    // The first address anyone is seen from isn't news.
    expect(open("staff_new_ip:%")).toBe("");

    sql(`update auth.sessions set ip = '203.0.113.9' where user_id = '${support.id}';`);
    await call(support, "admin_whoami");
    await call(support, "admin_whoami");
    const alerts = open("staff_new_ip:%").split("\n").filter(Boolean);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("warning");
    expect(alerts[0]).toContain("203.0.113.9");

    // Told once, then closed.
    const { data: pending } = await admin.rpc("ops_alerts_to_notify");
    const ids = (pending ?? [])
      .filter((a) => a.kind.startsWith("staff_new_ip:"))
      .map((a) => a.id);
    await admin.rpc("ops_mark_notified", { p_ids: ids });
    expect(open("staff_new_ip:%")).toBe("");
  });

  it("tells owners about every high-risk change carried out, from now on", async () => {
    // The first run starts the clock: the team set-up above isn't reported.
    await admin.rpc("ops_phase5_checks");
    const reported = () =>
      open("change_executed:%")
        .split("\n")
        .filter((l) => l && !l.startsWith("change_executed:start|"));
    expect(reported()).toEqual([]);

    const req = await call(adminStaff, "admin_request_change", {
      p_action: "ai.settings",
      p_target_type: "ai_setting",
      p_target_id: "form_review",
      p_payload: { max_tokens: 4000 },
      p_reason: "Shorter reviews",
    });
    await call(owner, "admin_decide_change", {
      p_id: req.id,
      p_approve: true,
      p_note: "",
    });
    expect(
      await call(adminStaff, "admin_apply_ai_change", { p_request_id: req.id }),
    ).toEqual({
      ok: true,
    });
    await admin.rpc("ops_phase5_checks");
    await admin.rpc("ops_phase5_checks");
    const told = open("change_executed:%")
      .split("\n")
      .filter((l) => l && !l.startsWith("change_executed:start|"));
    expect(told).toHaveLength(1);
    expect(told[0]).toContain("ai.settings");
    expect(told[0]).toContain("Shorter reviews");
  });

  it("records the monthly access review only when everyone was looked at", async () => {
    expect(await call(support, "admin_access_review")).toMatchObject({
      ok: false,
      code: "denied",
    });
    const review = await call(owner, "admin_access_review");
    const staff = review.staff as { user_id: string; status: string }[];
    expect(staff.map((s) => s.user_id).sort()).toEqual(
      [owner.id, adminStaff.id, support.id].sort(),
    );

    expect(
      await call(owner, "admin_record_access_review", {
        p_reviewed: [owner.id, adminStaff.id],
        p_notes: "",
      }),
    ).toEqual({ ok: false, code: "invalid", why: "review_incomplete" });
    expect(
      await call(owner, "admin_record_access_review", {
        p_reviewed: [owner.id, adminStaff.id, support.id],
        p_notes: "All still needed",
      }),
    ).toMatchObject({ ok: true });

    await admin.rpc("ops_phase5_checks");
    expect(open("access_review_due")).toBe("");
    sql("update private.access_reviews set reviewed_at = now() - interval '40 days';");
    await admin.rpc("ops_phase5_checks");
    expect(open("access_review_due")).toContain("warning");
  });

  it("records drills; only owners and admins may", async () => {
    const drill = {
      p_kind: "webhook_outage",
      p_scenario: "Test endpoint returned 503 for 20 minutes",
      p_outcome: "Alert after 30 minutes; every event delivered once afterwards",
      p_succeeded: true,
      p_follow_ups: "",
      p_evidence_url: null,
    };
    expect(await call(support, "admin_record_drill", drill)).toMatchObject({
      ok: false,
      code: "denied",
    });
    expect(
      await call(adminStaff, "admin_record_drill", {
        ...drill,
        p_evidence_url: "http://x.test",
      }),
    ).toEqual({ ok: false, code: "invalid" });
    expect(await call(adminStaff, "admin_record_drill", drill)).toMatchObject({
      ok: true,
    });
    const list = await call(support, "admin_list_drills");
    expect((list.drills as { kind: string }[]).map((d) => d.kind)).toEqual([
      "webhook_outage",
    ]);
  });

  it("alerts when no restore drill worked in 90 days", async () => {
    sql("delete from private.restore_tests;");
    await admin.rpc("ops_phase5_checks");
    // A new team isn't nagged straight away.
    expect(open("restore_drill_overdue")).toBe("");
    sql(
      `update private.staff_members set created_at = now() - interval '100 days' where user_id = '${owner.id}';`,
    );
    await admin.rpc("ops_phase5_checks");
    expect(open("restore_drill_overdue")).toContain("warning");
    expect(
      await call(owner, "admin_record_restore_test", {
        p_backup_time: new Date().toISOString(),
        p_restored_to: "Spare project",
        p_checks: "Row counts match",
        p_evidence_url: null,
        p_succeeded: true,
      }),
    ).toEqual({ ok: true });
    await admin.rpc("ops_phase5_checks");
    expect(open("restore_drill_overdue")).toBe("");
  });

  it("step-up needs an authenticator code from the last 10 minutes", () => {
    const amr = (method: string, secondsAgo: number) =>
      JSON.stringify({
        amr: [{ method, timestamp: Math.floor(Date.now() / 1000) - secondsAgo }],
      });
    const fresh = (jwt: string) =>
      sql(`select private.recent_totp('${jwt}'::jsonb, interval '10 minutes')`);
    expect(fresh(amr("totp", 60))).toBe("t");
    expect(fresh(amr("totp", 11 * 60))).toBe("f");
    // A password alone is never a fresh second factor.
    expect(fresh(amr("password", 10))).toBe("f");
    expect(fresh("{}")).toBe("f");
  });

  it("keeps the checks to the secret key", async () => {
    const { error } = await support.client.rpc("ops_phase5_checks" as never);
    expect(error).not.toBeNull();
  });
});
