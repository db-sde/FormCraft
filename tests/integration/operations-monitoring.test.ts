import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Json } from "@/lib/supabase/database.types";
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
 * Super Admin Phase 2 (migration 72) against the real database: reports
 * that match the real records, the form inventory, resource use, and the
 * alert checks catching a failing scheduler, late deliveries and an
 * emergency approval, then clearing once fixed.
 */
const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
const describeLocal = canRunLocally ? describe : describe.skip;

describeLocal("Super Admin Phase 2: reports, operations, alerts", () => {
  let owner: Person;
  let support: Person;
  let customer: Person;
  let workspaceId: string;
  let formId: string;
  let endpointId: string;
  const people: Person[] = [];

  beforeAll(async () => {
    owner = await person("ops-owner", runId, { mfa: true });
    support = await person("ops-support", runId, { mfa: true });
    customer = await person("ops-customer", runId, { mfa: false });
    people.push(owner, support, customer);
    sql("delete from private.ops_alerts;");
    await staffTeam(owner, [{ person: support, role: "support" }]);

    const { data: ws } = await admin
      .from("workspaces")
      .insert({ name: `Ops ${runId}`, slug: `ops-${runId}`, owner_id: customer.id })
      .select("id")
      .single();
    workspaceId = ws!.id;
    await admin
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: customer.id, role: "owner" });
    const { data: form } = await admin
      .from("forms")
      .insert({
        workspace_id: workspaceId,
        title: `Inventory ${runId}`,
        slug: `ops-${runId}`,
        created_by: customer.id,
      })
      .select("id")
      .single();
    formId = form!.id;
    const schema = {
      schemaVersion: 1,
      meta: { title: "Inventory" },
      theme: {},
      endings: [{ id: "end", title: "Thanks", isDefault: true }],
      questions: [
        {
          id: "q1",
          type: "short_text",
          order: 0,
          label: "Name",
          required: false,
          settings: {},
        },
      ],
      logic: [],
    } as unknown as Json;
    await admin.rpc("publish_form_version", {
      target_form_id: formId,
      compiled_schema: schema,
    });
    const versionId = (
      await admin
        .from("form_versions")
        .select("id")
        .eq("form_id", formId)
        .eq("status", "published")
        .single()
    ).data!.id;
    for (let i = 0; i < 3; i += 1) {
      await admin.from("responses").insert({
        form_id: formId,
        form_version_id: versionId,
        status: "completed",
        completed_at: new Date().toISOString(),
      });
    }
    const { data: hook } = await admin
      .from("webhook_endpoints")
      .insert({
        form_id: formId,
        url: "https://hooks.example.com/x",
        kind: "webhook",
        signing_secret: "test-signing-secret",
      })
      .select("id")
      .single();
    endpointId = hook!.id;
  }, 90_000);

  afterAll(async () => {
    if (!canRunLocally) return;
    sql("delete from private.ops_alerts;");
    clearStaff();
    if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const p of people) await admin.auth.admin.deleteUser(p.id);
  });

  it("reports match the real records", async () => {
    const r = await call(support, "admin_usage_overview");
    expect(r.ok).toBe(true);
    const totals = r.totals as Record<string, number>;
    const direct = (q: string) => Number(sql(q));
    expect(totals.workspaces).toBe(direct("select count(*) from public.workspaces"));
    expect(totals.users).toBe(direct("select count(*) from auth.users"));
    expect(totals.forms).toBe(
      direct("select count(*) from public.forms where deleted_at is null"),
    );
    expect(totals.responses).toBe(
      direct(
        "select count(*) from public.responses where status = 'completed' and not is_preview",
      ),
    );
    const byDay = (r.submissions_by_day as { count: number }[]).reduce(
      (n, d) => n + d.count,
      0,
    );
    expect(byDay).toBe(
      direct(
        "select count(*) from public.responses where status = 'completed' and not is_preview and completed_at > now() - interval '30 days'",
      ),
    );
    expect((r.adoption as Record<string, number>).webhooks).toBe(
      direct(
        "select count(distinct f.workspace_id) from public.webhook_endpoints w join public.forms f on f.id = w.form_id where w.kind = 'webhook'",
      ),
    );
    expect(await call(customer, "admin_usage_overview")).toMatchObject({
      ok: false,
      code: "denied",
    });
  });

  it("lists forms across workspaces with their state and responses, never their questions", async () => {
    const r = await call(support, "admin_form_inventory", {
      p_query: `inventory ${runId}`,
    });
    const forms = r.forms as Record<string, unknown>[];
    expect(forms).toHaveLength(1);
    expect(forms[0]).toMatchObject({
      id: formId,
      state: "live",
      responses: 3,
      workspace_id: workspaceId,
    });
    expect(JSON.stringify(forms)).not.toContain('"questions"');
    const drafts = await call(support, "admin_form_inventory", {
      p_query: `inventory ${runId}`,
      p_state: "draft",
    });
    expect(drafts.forms).toEqual([]);
  });

  it("ranks workspaces by a measure, and refuses unknown ones", async () => {
    const r = await call(support, "admin_resource_usage", {
      p_sort: "forms",
      p_limit: 100,
    });
    expect(r.ok).toBe(true);
    const row = (r.workspaces as { id: string; forms: number }[]).find(
      (w) => w.id === workspaceId,
    );
    expect(row?.forms).toBe(1);
    expect(await call(support, "admin_resource_usage", { p_sort: "drop table" })).toEqual(
      {
        ok: false,
        code: "bad_sort",
      },
    );
  });

  it("alerts on a failing scheduler and late deliveries, and clears when fixed", async () => {
    // Three failed scheduler calls, nothing answered OK.
    sql("delete from net._http_response where created > now() - interval '20 minutes';");
    sql(
      "insert into net._http_response (id, status_code, created) values (-1, 401, now()), (-2, 401, now()), (-3, 401, now());",
    );
    // A delivery an hour late.
    const { data: response } = await admin
      .from("responses")
      .select("id")
      .eq("form_id", formId)
      .limit(1)
      .single();
    const { data: late } = await admin
      .from("webhook_deliveries")
      .insert({
        endpoint_id: endpointId,
        response_id: response!.id,
        event_id: crypto.randomUUID(),
        event_type: "response.completed",
        dedupe_key: `late-${runId}`,
        payload: {},
        status: "failed",
        next_attempt_at: new Date(Date.now() - 60 * 60_000).toISOString(),
      })
      .select("id")
      .single();

    await admin.rpc("ops_run_checks");
    const health = await call(support, "admin_ops_health");
    const kinds = (health.alerts as { kind: string; severity: string }[]).map(
      (a) => `${a.kind}:${a.severity}`,
    );
    expect(kinds).toEqual(
      expect.arrayContaining([
        "scheduler_failing:critical",
        "deliveries_overdue:warning",
      ]),
    );
    const toNotify = (await admin.rpc("ops_alerts_to_notify")).data!.map((a) => a.kind);
    expect(toNotify).toEqual(
      expect.arrayContaining(["scheduler_failing", "deliveries_overdue"]),
    );

    // Fixed: the alerts close by themselves.
    sql("delete from net._http_response where id in (-1, -2, -3);");
    await admin
      .from("webhook_deliveries")
      .update({ status: "succeeded" })
      .eq("id", late!.id);
    await admin.rpc("ops_run_checks");
    const after = await call(support, "admin_ops_health");
    const open = (after.alerts as { kind: string }[]).map((a) => a.kind);
    expect(open).not.toContain("scheduler_failing");
    expect(open).not.toContain("deliveries_overdue");
  });

  it("tells owners about every emergency approval, once", async () => {
    await admin.rpc("ops_run_checks");
    const notify = (await admin.rpc("ops_alerts_to_notify")).data!;
    const emergencies = notify.filter((a) => a.kind.startsWith("emergency_approval:"));
    expect(emergencies.length).toBeGreaterThanOrEqual(1);
    await admin.rpc("ops_mark_notified", { p_ids: emergencies.map((a) => a.id) });
    await admin.rpc("ops_run_checks");
    const again = (await admin.rpc("ops_alerts_to_notify")).data!;
    expect(again.some((a) => a.kind.startsWith("emergency_approval:"))).toBe(false);
    const recipients = (await admin.rpc("ops_alert_recipients")).data!.map(
      (r) => r.email,
    );
    expect(recipients).toContain(owner.email);
    expect(recipients).not.toContain(support.email);
  });

  it("records restore drills; only owners and admins may", async () => {
    const drill = {
      p_backup_time: new Date().toISOString(),
      p_restored_to: "Spare project formcraft-restore",
      p_checks: "Row counts match; a form opens; a response exports",
      p_evidence_url: "https://example.com/evidence",
      p_succeeded: true,
    };
    expect(await call(support, "admin_record_restore_test", drill)).toMatchObject({
      ok: false,
      code: "denied",
    });
    expect(
      await call(owner, "admin_record_restore_test", {
        ...drill,
        p_evidence_url: "http://x.test",
      }),
    ).toEqual({ ok: false, code: "invalid" });
    expect(await call(owner, "admin_record_restore_test", drill)).toEqual({ ok: true });
    const health = await call(owner, "admin_ops_health");
    expect((health.restore_tests as { restored_to: string }[])[0].restored_to).toBe(
      "Spare project formcraft-restore",
    );
  });

  it("keeps the alert job's functions to the secret key", async () => {
    for (const fn of ["ops_run_checks", "ops_alerts_to_notify", "ops_alert_recipients"]) {
      const { error } = await owner.client.rpc(fn as never);
      expect(error, fn).not.toBeNull();
    }
  });
});
