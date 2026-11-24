import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { checkAvailability } from "@/domains/forms/availability";
import { totp } from "../totp";

/**
 * Super Admin Phase 1 (migration 71) against the real database: finding
 * customers, the 360 view, account status enforced by the database
 * itself, and plan changes through approved requests.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin: SupabaseClient<Database> = createClient<Database>(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) =>
  execFileSync("psql", [DB_URL, "-tAq", "-v", "ON_ERROR_STOP=1", "-c", q], {
    encoding: "utf8",
  }).trim();
let psqlAvailable = true;
try {
  execFileSync("psql", ["--version"]);
} catch {
  psqlAvailable = false;
}
const local = /127\.0\.0\.1|localhost/.test(url);
const describeLocal = local && psqlAvailable ? describe : describe.skip;

const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
type Person = { id: string; email: string; client: SupabaseClient<Database> };
const people: Person[] = [];

async function person(name: string, mfa: boolean): Promise<Person> {
  const email = `${name}-${runId}@ops.example.com`;
  const password = `Pw-${crypto.randomUUID()}`;
  const { data } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false },
  });
  await client.auth.signInWithPassword({ email, password });
  if (mfa) {
    const { data: factor } = await client.auth.mfa.enroll({ factorType: "totp" });
    await client.auth.mfa.challengeAndVerify({
      factorId: factor!.id,
      code: totp(factor!.totp.secret),
    });
  }
  const p = { id: data.user!.id, email, client };
  people.push(p);
  return p;
}

type Result = { ok: boolean; code?: string; [k: string]: unknown };
const call = async (p: Person, fn: string, args: Record<string, unknown> = {}) => {
  const { data, error } = await p.client.rpc(fn as never, args as never);
  if (error) return { ok: false, code: "error", message: error.message } as Result;
  return data as unknown as Result;
};

describeLocal("Super Admin Phase 1: customers, status, plans", () => {
  let owner: Person;
  let approver: Person;
  let member: Person;
  let workspaceId: string;
  let formId: string;
  let versionId: string;
  const testPlan = `t_${runId}`;

  /** Request (by the owner) → approve (by the admin) → apply (owner). */
  async function change(
    action: string,
    targetType: string,
    targetId: string,
    payload: Record<string, unknown>,
  ) {
    const req = await call(owner, "admin_request_change", {
      p_action: action,
      p_target_type: targetType,
      p_target_id: targetId,
      p_payload: payload,
      p_reason: `Test ${action} ${runId}`,
    });
    expect(req).toMatchObject({ ok: true });
    expect(
      await call(approver, "admin_decide_change", {
        p_id: req.id,
        p_approve: true,
        p_note: "ok",
      }),
    ).toEqual({ ok: true });
    return call(owner, "admin_apply_change", { p_request_id: req.id });
  }

  beforeAll(async () => {
    sql("delete from private.change_requests; delete from private.staff_members;");
    owner = await person("owner", true);
    approver = await person("approver", true);
    member = await person("member", false);
    await admin.rpc("admin_bootstrap_owner", {
      p_user_id: owner.id,
      p_display_name: "Owner",
    });
    // The approver joins as admin through a logged emergency (one owner).
    const add = await call(owner, "admin_request_change", {
      p_action: "staff.add",
      p_target_type: "staff",
      p_target_id: approver.id,
      p_payload: { role: "admin", display_name: "Approver" },
      p_reason: "Second approver for the test",
    });
    await call(owner, "admin_emergency_approve", {
      p_id: add.id,
      p_reason: "Only one approver exists in this test",
    });
    await call(owner, "admin_apply_staff_change", { p_request_id: add.id });

    const { data: ws } = await admin
      .from("workspaces")
      .insert({ name: `Acme ${runId}`, slug: `acme-${runId}`, owner_id: member.id })
      .select("id")
      .single();
    workspaceId = ws!.id;
    await admin
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: member.id, role: "owner" });
    const { data: form } = await admin
      .from("forms")
      .insert({
        workspace_id: workspaceId,
        title: "Survey",
        slug: `acme-${runId}`,
        created_by: member.id,
      })
      .select("id")
      .single();
    formId = form!.id;
    const schema = {
      schemaVersion: 1,
      meta: { title: "Survey" },
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
    versionId = (
      await admin
        .from("form_versions")
        .select("id")
        .eq("form_id", formId)
        .eq("status", "published")
        .single()
    ).data!.id;
    sql(
      `insert into public.plans (id, name, sort_order, entitlements)
       values ('${testPlan}', 'Test plan', 99, '{"members": 2}')`,
    );
  }, 90_000);

  afterAll(async () => {
    if (!local || !psqlAvailable) return;
    sql("delete from private.change_requests; delete from private.staff_members;");
    if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
    sql(`delete from public.plans where id = '${testPlan}'`);
    for (const p of people) await admin.auth.admin.deleteUser(p.id);
  });

  it("finds customers by member email, name or slug; not for non-staff", async () => {
    for (const q of [member.email, `acme ${runId}`, `acme-${runId}`]) {
      const found = await call(owner, "admin_search_customers", { p_query: q });
      expect(found.ok).toBe(true);
      expect((found.customers as { id: string }[]).map((c) => c.id)).toContain(
        workspaceId,
      );
    }
    expect(await call(owner, "admin_search_customers", { p_query: "a" })).toEqual({
      ok: false,
      code: "query_too_short",
    });
    // Wildcards are taken literally.
    const wild = await call(owner, "admin_search_customers", { p_query: "%%" });
    expect((wild.customers as unknown[]).length).toBe(0);
    expect(
      await call(member, "admin_search_customers", { p_query: "acme" }),
    ).toMatchObject({
      ok: false,
      code: "denied",
    });
  });

  it("shows the 360 view without answers, and records that it was opened", async () => {
    const profile = await call(owner, "admin_customer_profile", {
      p_workspace_id: workspaceId,
    });
    expect(profile).toMatchObject({
      ok: true,
      workspace: { id: workspaceId, plan_id: "free", status: "active" },
      counts: { forms: 1, live_forms: 1 },
    });
    expect((profile.members as { email: string }[]).map((m) => m.email)).toEqual([
      member.email,
    ]);
    expect(JSON.stringify(profile)).not.toContain('"answers"');
    const trail = await call(owner, "admin_read_audit", { p_limit: 20 });
    expect(
      (trail.entries as { action: string; target_id: string }[]).some(
        (e) => e.action === "customer.viewed" && e.target_id === workspaceId,
      ),
    ).toBe(true);
  });

  it("changes nothing without an approved request", async () => {
    const req = await call(owner, "admin_request_change", {
      p_action: "workspace.status",
      p_target_type: "workspace",
      p_target_id: workspaceId,
      p_payload: { status: "suspended" },
      p_reason: "Unapproved attempt",
    });
    expect(await call(owner, "admin_apply_change", { p_request_id: req.id })).toEqual({
      ok: false,
      code: "approval_required",
    });
    const { data } = await admin
      .from("workspaces")
      .select("status")
      .eq("id", workspaceId)
      .single();
    expect(data!.status).toBe("active");
  });

  it("suspended: read-only for members, forms closed, publishing refused; told in their audit log", async () => {
    expect(
      await change("workspace.status", "workspace", workspaceId, {
        status: "suspended",
        message: "Unpaid invoice",
      }),
    ).toEqual({ ok: true });

    // Members can't edit, create or undo it themselves.
    await member.client.from("forms").update({ title: "Renamed" }).eq("id", formId);
    const { data: form } = await admin
      .from("forms")
      .select("title")
      .eq("id", formId)
      .single();
    expect(form!.title).toBe("Survey");
    const created = await member.client.from("forms").insert({
      workspace_id: workspaceId,
      title: "New",
      slug: `new-${runId}`,
      created_by: member.id,
    });
    expect(created.error).not.toBeNull();
    await member.client
      .from("workspaces")
      .update({ status: "active" })
      .eq("id", workspaceId);
    const { data: ws } = await admin
      .from("workspaces")
      .select("status, status_message")
      .eq("id", workspaceId)
      .single();
    expect(ws).toEqual({ status: "suspended", status_message: "Unpaid invoice" });
    // Members can still read their data.
    const read = await member.client
      .from("forms")
      .select("id")
      .eq("workspace_id", workspaceId);
    expect(read.data).toHaveLength(1);

    // No responses, whichever path; no publishing.
    expect(await checkAvailability(admin, formId)).toMatchObject({ open: false });
    const started = await admin
      .from("responses")
      .insert({ form_id: formId, form_version_id: versionId, status: "in_progress" });
    expect(started.error?.message).toContain("workspace_suspended");
    const published = await admin.rpc("publish_form_version", {
      target_form_id: formId,
      compiled_schema: (
        await admin.from("form_versions").select("schema").eq("id", versionId).single()
      ).data!.schema,
    });
    expect(published.error?.message).toContain("workspace_not_active");

    const { data: told } = await admin
      .from("audit_logs")
      .select("action, metadata")
      .eq("workspace_id", workspaceId)
      .eq("action", "support.status_changed");
    expect(told).toEqual([
      {
        action: "support.status_changed",
        metadata: { by: "FormCraft support", from: "active", to: "suspended" },
      },
    ]);
  });

  it("restricted: live forms keep working, but nothing new is created or published", async () => {
    expect(
      await change("workspace.status", "workspace", workspaceId, {
        status: "restricted",
      }),
    ).toEqual({
      ok: true,
    });
    expect(await checkAvailability(admin, formId)).toEqual({ open: true });
    const created = await member.client.from("forms").insert({
      workspace_id: workspaceId,
      title: "New",
      slug: `new2-${runId}`,
      created_by: member.id,
    });
    expect(created.error).not.toBeNull();
    const { error: renameError } = await member.client
      .from("forms")
      .update({ title: "Still editable" })
      .eq("id", formId);
    expect(renameError).toBeNull();
    expect(
      await change("workspace.status", "workspace", workspaceId, { status: "active" }),
    ).toEqual({
      ok: true,
    });
  });

  it("changes a workspace's plan and overrides, and refuses entitlements it doesn't know", async () => {
    expect(
      await change("workspace.plan", "workspace", workspaceId, {
        plan_id: "pro",
        overrides: { members: 5, api_access: true },
      }),
    ).toEqual({ ok: true });
    const { data } = await admin
      .from("workspaces")
      .select("plan_id, entitlement_overrides")
      .eq("id", workspaceId)
      .single();
    expect(data).toEqual({
      plan_id: "pro",
      entitlement_overrides: { members: 5, api_access: true },
    });

    const bad = await change("workspace.plan", "workspace", workspaceId, {
      plan_id: "pro",
      overrides: { members: "lots" },
    });
    expect(bad).toMatchObject({ ok: false, code: "error" });
    const unknown = await change("workspace.plan", "workspace", workspaceId, {
      plan_id: "pro",
      overrides: { free_money: true },
    });
    expect(unknown).toMatchObject({ ok: false, code: "error" });
  });

  it("changes a plan's entitlements for every workspace on it", async () => {
    expect(
      await change("plan.update", "plan", testPlan, {
        entitlements: { members: 3, responses_per_month: null, sso: true },
      }),
    ).toEqual({ ok: true });
    const { data } = await admin
      .from("plans")
      .select("entitlements")
      .eq("id", testPlan)
      .single();
    expect(data!.entitlements).toEqual({
      members: 3,
      responses_per_month: null,
      sso: true,
    });
  });
});
