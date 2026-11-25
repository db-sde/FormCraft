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
 * Super Admin Phase 3 (migration 73) against the real database: the
 * gateway's check (switch, feature, ceiling, credits taken atomically),
 * cost recorded per workspace at each model's price, and settings that
 * change only with approval, except pausing.
 */
const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
const describeLocal = canRunLocally ? describe : describe.skip;

type Begin = { ok: boolean; code?: string; model?: string; max_tokens?: number | null };
const begin = async (
  workspaceId: string,
  feature = "form_edit",
  limit: number | null = 100,
) =>
  (
    await admin.rpc("ai_begin", {
      p_workspace_id: workspaceId,
      p_feature: feature,
      p_credit_limit: limit as number,
    })
  ).data as unknown as Begin;

const record = (
  workspaceId: string,
  attempts: Record<string, unknown>[],
  outcome = "ok",
  requested = "claude-opus-5-5",
) =>
  admin.rpc("ai_record_usage", {
    p_workspace_id: workspaceId,
    p_feature: "form_edit",
    p_requested_model: requested,
    p_served_model: requested,
    p_attempts: attempts as never,
    p_latency_ms: 1200,
    p_outcome: outcome,
  });

const setting = (feature: string) =>
  JSON.parse(
    sql(`select to_jsonb(s) from private.ai_settings s where feature = '${feature}'`),
  );

describeLocal("Super Admin Phase 3: the AI gateway", () => {
  let owner: Person;
  let adminStaff: Person;
  let support: Person;
  let customer: Person;
  let workspaceId: string;
  const people: Person[] = [];

  const reset = () =>
    sql(`
      update private.ai_settings set enabled = true, model = null, max_tokens = null
       where feature <> '*';
      update private.ai_settings set enabled = true, model = 'claude-opus-5-5',
             daily_ceiling_usd = 50 where feature = '*';
      delete from private.ai_daily_cost where day = (now() at time zone 'UTC')::date;
      delete from private.ops_alerts where kind like 'ai_%';`);

  beforeAll(async () => {
    owner = await person("ai-owner", runId, { mfa: true });
    adminStaff = await person("ai-admin", runId, { mfa: true });
    support = await person("ai-support", runId, { mfa: true });
    customer = await person("ai-customer", runId, { mfa: false });
    people.push(owner, adminStaff, support, customer);
    await staffTeam(owner, [
      { person: adminStaff, role: "admin" },
      { person: support, role: "support" },
    ]);
    const { data: ws } = await admin
      .from("workspaces")
      .insert({ name: `AI ${runId}`, slug: `ai-${runId}`, owner_id: customer.id })
      .select("id")
      .single();
    workspaceId = ws!.id;
    reset();
  }, 90_000);

  afterAll(async () => {
    if (!canRunLocally) return;
    reset();
    if (workspaceId)
      sql(`delete from private.ai_usage where workspace_id = '${workspaceId}';`);
    clearStaff();
    if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const p of people) await admin.auth.admin.deleteUser(p.id);
  });

  it("allows a call with the configured model, and refuses when switched off", async () => {
    expect(await begin(workspaceId)).toMatchObject({
      ok: true,
      model: "claude-opus-5-5",
    });
    sql(
      "update private.ai_settings set model = 'claude-haiku-5-5', max_tokens = 1000 where feature = 'form_edit';",
    );
    expect(await begin(workspaceId)).toMatchObject({
      ok: true,
      model: "claude-haiku-5-5",
      max_tokens: 1000,
    });
    sql("update private.ai_settings set enabled = false where feature = 'form_edit';");
    expect(await begin(workspaceId)).toEqual({ ok: false, code: "feature_off" });
    sql("update private.ai_settings set enabled = false where feature = '*';");
    expect(await begin(workspaceId, "form_review")).toEqual({ ok: false, code: "off" });
    expect(await begin(workspaceId, "made_up")).toEqual({ ok: false, code: "off" });
    reset();
    expect(await begin(workspaceId, "made_up")).toEqual({
      ok: false,
      code: "unknown_feature",
    });
  });

  it("can't be beaten on credits by calls at the same moment", async () => {
    sql(`delete from public.usage_counters where workspace_id = '${workspaceId}';`);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => begin(workspaceId, "form_edit", 4)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(4);
    expect(results.filter((r) => r.code === "credits")).toHaveLength(6);
  });

  it("records cost at each model's price, fallbacks included", async () => {
    if (workspaceId)
      sql(`delete from private.ai_usage where workspace_id = '${workspaceId}';`);
    // Opus 5.5: 1,000 in × $4 + 500 out × $20 + 2,000 cache reads × $0.20 = 14,400 µ$.
    const plain = await record(workspaceId, [
      {
        model: "claude-opus-5-5",
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 2000,
        cache_creation_input_tokens: 0,
      },
    ]);
    expect(plain.data).toBe(14_400);
    // Refused on Opus 5.5 before output, served by Opus 4.8 ($5 / $25):
    // 1,000 × 4 + 900 × 5 + 200 × 25 = 13,500 µ$.
    const fallback = await record(workspaceId, [
      { model: null, input_tokens: 1000, output_tokens: 0 },
      { model: "claude-opus-4-8", input_tokens: 900, output_tokens: 200 },
    ]);
    expect(fallback.data).toBe(13_500);
    await record(workspaceId, [], "error");

    const overview = await call(support, "admin_ai_overview");
    expect(overview.ok).toBe(true);
    const mine = (
      overview.top_workspaces as { id: string; cost_micros: number; calls: number }[]
    ).find((w) => w.id === workspaceId);
    expect(mine).toMatchObject({ cost_micros: 27_900, calls: 3 });
    const edit = (overview.by_feature as { feature: string; errors: number }[]).find(
      (f) => f.feature === "form_edit",
    );
    expect(edit?.errors).toBeGreaterThanOrEqual(1);
    expect(await call(customer, "admin_ai_overview")).toMatchObject({
      ok: false,
      code: "denied",
    });
  });

  it("charges an unpriced model at the requested model's rate, and says so", async () => {
    const r = await record(workspaceId, [
      { model: "claude-future-9", input_tokens: 1000, output_tokens: 0 },
    ]);
    expect(r.data).toBe(4_000);
    expect(
      sql(
        "select count(*) from private.ops_alerts where kind = 'ai_price_missing' and resolved_at is null",
      ),
    ).toBe("1");
  });

  it("stops every call at the daily ceiling, and starts again when it's raised", async () => {
    sql("update private.ai_settings set daily_ceiling_usd = 1 where feature = '*';");
    await record(workspaceId, [{ model: "claude-opus-5-5", output_tokens: 60_000 }]); // $1.20
    expect(await begin(workspaceId)).toEqual({ ok: false, code: "ceiling" });
    expect(
      sql(
        "select severity from private.ops_alerts where kind = 'ai_ceiling_reached' and resolved_at is null",
      ),
    ).toBe("critical");
    sql("update private.ai_settings set daily_ceiling_usd = 5000 where feature = '*';");
    expect((await begin(workspaceId)).ok).toBe(true);
    expect(
      sql(
        "select count(*) from private.ops_alerts where kind = 'ai_ceiling_reached' and resolved_at is null",
      ),
    ).toBe("0");
    reset();
  });

  it("changes a model only with someone else's approval, and audits it", async () => {
    // Support may look, not ask.
    expect(
      await call(support, "admin_request_change", {
        p_action: "ai.settings",
        p_target_type: "ai_setting",
        p_target_id: "follow_up",
        p_payload: { model: "claude-haiku-5-5" },
        p_reason: "Faster follow-ups",
      }),
    ).toMatchObject({ ok: false, code: "denied" });

    const req = await call(adminStaff, "admin_request_change", {
      p_action: "ai.settings",
      p_target_type: "ai_setting",
      p_target_id: "follow_up",
      p_payload: { model: "claude-haiku-5-5", max_tokens: 600 },
      p_reason: "Faster follow-ups for respondents",
    });
    expect(req.ok).toBe(true);
    expect(
      await call(adminStaff, "admin_apply_ai_change", { p_request_id: req.id }),
    ).toEqual({
      ok: false,
      code: "approval_required",
    });
    expect(
      await call(adminStaff, "admin_decide_change", {
        p_id: req.id,
        p_approve: true,
        p_note: "",
      }),
    ).toMatchObject({ ok: false, code: "own_request" });
    expect(
      await call(owner, "admin_decide_change", {
        p_id: req.id,
        p_approve: true,
        p_note: "ok",
      }),
    ).toEqual({ ok: true });
    expect(
      await call(adminStaff, "admin_apply_ai_change", { p_request_id: req.id }),
    ).toEqual({
      ok: true,
    });
    expect(setting("follow_up")).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 600,
      updated_by: adminStaff.id,
    });
    const audit = JSON.parse(
      sql(
        "select details from private.platform_audit_log where action = 'ai.settings' and outcome = 'succeeded' order by id desc limit 1",
      ),
    );
    expect(audit.before.model).toBeNull();
    expect(audit.after.model).toBe("claude-haiku-5-5");
    expect(await call(owner, "admin_verify_audit_chain")).toBeDefined();
    reset();
  });

  it("refuses a setting the gateway doesn't allow, without using the approval", async () => {
    const req = await call(adminStaff, "admin_request_change", {
      p_action: "ai.settings",
      p_target_type: "ai_setting",
      p_target_id: "form_edit",
      p_payload: { model: "gpt-4o" },
      p_reason: "Trying another model",
    });
    await call(owner, "admin_decide_change", {
      p_id: req.id,
      p_approve: true,
      p_note: "",
    });
    expect(
      await call(adminStaff, "admin_apply_ai_change", { p_request_id: req.id }),
    ).toMatchObject({ ok: false, code: "invalid", why: "that model is not allowed" });
    expect(sql(`select status from private.change_requests where id = '${req.id}'`)).toBe(
      "approved",
    );
    expect(() =>
      sql("update private.ai_settings set model = 'gpt-4o' where feature = 'form_edit';"),
    ).toThrow();
  });

  it("lets one owner or admin pause AI at once; turning it back on needs approval", async () => {
    expect(
      await call(support, "admin_ai_pause", { p_reason: "Runaway spend" }),
    ).toMatchObject({
      ok: false,
      code: "denied",
    });
    expect(
      await call(adminStaff, "admin_ai_pause", { p_reason: "Runaway spend" }),
    ).toEqual({
      ok: true,
    });
    expect(await begin(workspaceId)).toEqual({ ok: false, code: "off" });
    expect(
      sql(
        "select message from private.ops_alerts where kind = 'ai_paused' and resolved_at is null",
      ),
    ).toContain("Runaway spend");

    const req = await call(adminStaff, "admin_request_change", {
      p_action: "ai.settings",
      p_target_type: "ai_setting",
      p_target_id: "*",
      p_payload: { enabled: true },
      p_reason: "Spend is back to normal",
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
    expect((await begin(workspaceId)).ok).toBe(true);
    expect(
      sql(
        "select count(*) from private.ops_alerts where kind = 'ai_paused' and resolved_at is null",
      ),
    ).toBe("0");
  });

  it("keeps the gateway's functions to the secret key", async () => {
    for (const [fn, args] of [
      [
        "ai_begin",
        { p_workspace_id: workspaceId, p_feature: "form_edit", p_credit_limit: 9 },
      ],
      ["ai_record_usage", { p_workspace_id: workspaceId, p_feature: "form_edit" }],
    ] as const) {
      const { error } = await customer.client.rpc(fn as never, args as never);
      expect(error, fn).not.toBeNull();
    }
  });
});
