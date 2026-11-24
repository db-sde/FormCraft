import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { totp } from "../totp";

/**
 * Super Admin Phase 0 (migration 70, docs/super-admin-design.md §3.2–3.6)
 * against the real database: who counts as staff, the gate every admin
 * function passes through, two-person approvals, and the audit log that
 * can only be added to and shows any edit.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin: SupabaseClient<Database> = createClient<Database>(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const local = /127\.0\.0\.1|localhost/.test(url);

/** Superuser SQL on the local database (cleanup and tamper checks). */
function sql(query: string): string {
  return execFileSync("psql", [DB_URL, "-tAq", "-v", "ON_ERROR_STOP=1", "-c", query], {
    encoding: "utf8",
  }).trim();
}
let psqlAvailable = true;
try {
  execFileSync("psql", ["--version"]);
} catch {
  psqlAvailable = false;
}

const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
type Person = { id: string; email: string; client: SupabaseClient<Database> };
const people: Person[] = [];

async function person(name: string, mfa: boolean): Promise<Person> {
  const email = `${name}-${runId}@staff.example.com`;
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
  if (mfa) await secondFactor(client);
  const p = { id: data.user!.id, email, client };
  people.push(p);
  return p;
}

/** Enrol and verify TOTP: the session becomes AAL2 with a fresh `amr`. */
async function secondFactor(client: SupabaseClient<Database>) {
  const { data: factor, error } = await client.auth.mfa.enroll({ factorType: "totp" });
  if (error) throw error;
  const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: totp(factor.totp.secret),
  });
  if (verifyError) throw verifyError;
}

const call = async (p: Person, fn: string, args: Record<string, unknown> = {}) => {
  const { data, error } = await p.client.rpc(fn as never, args as never);
  if (error) return { ok: false, code: "error", message: error.message };
  return data as unknown as { ok: boolean; code?: string; [k: string]: unknown };
};

/** Request → (approve) → apply, returning each step's result. */
async function staffChange(
  requester: Person,
  approver: Person | "emergency",
  action: "staff.add" | "staff.set_role" | "staff.disable",
  target: Person,
  payload: Record<string, string>,
) {
  const req = await call(requester, "admin_request_change", {
    p_action: action,
    p_target_type: "staff",
    p_target_id: target.id,
    p_payload: payload,
    p_reason: `Test: ${action} ${runId}`,
  });
  expect(req).toMatchObject({ ok: true });
  const id = req.id as string;
  const decided =
    approver === "emergency"
      ? await call(requester, "admin_emergency_approve", {
          p_id: id,
          p_reason: "Only one approver exists in this test",
        })
      : await call(approver, "admin_decide_change", {
          p_id: id,
          p_approve: true,
          p_note: "ok",
        });
  const applied = await call(requester, "admin_apply_staff_change", { p_request_id: id });
  return { id, decided, applied };
}

const describeLocal = local && psqlAvailable ? describe : describe.skip;

describeLocal("Super Admin Phase 0: staff, gate, approvals, audit", () => {
  let owner: Person;
  let adminStaff: Person;
  let support: Person;
  let outsider: Person;
  let customer: Person;

  beforeAll(async () => {
    // Staff are global: start from none (local database only).
    sql(
      "delete from private.restore_tests; delete from private.change_requests; delete from private.staff_members;",
    );
    owner = await person("owner", false);
    adminStaff = await person("admin", true);
    support = await person("support", false);
    outsider = await person("outsider", true);
    customer = await person("customer", true);
    const { data: ws } = await admin
      .from("workspaces")
      .insert({ name: "Customer", slug: `staff-cust-${runId}`, owner_id: customer.id })
      .select("id")
      .single();
    await admin
      .from("workspace_members")
      .insert({ workspace_id: ws!.id, user_id: customer.id, role: "owner" });
  }, 60_000);

  afterAll(async () => {
    if (!local || !psqlAvailable) return;
    sql(
      "delete from private.restore_tests; delete from private.change_requests; delete from private.staff_members;",
    );
    await admin.from("workspaces").delete().eq("slug", `staff-cust-${runId}`);
    for (const p of people) await admin.auth.admin.deleteUser(p.id);
  });

  it("bootstraps the first owner once, and only with the secret key", async () => {
    const asMember = await outsider.client.rpc("admin_bootstrap_owner", {
      p_user_id: outsider.id,
      p_display_name: "Sneaky",
    });
    expect(asMember.error).not.toBeNull();

    const first = await admin.rpc("admin_bootstrap_owner", {
      p_user_id: owner.id,
      p_display_name: "First owner",
    });
    expect(first.error).toBeNull();
    const second = await admin.rpc("admin_bootstrap_owner", {
      p_user_id: outsider.id,
      p_display_name: "Second",
    });
    expect(second.error?.message).toContain("staff already exist");
  });

  it("refuses everyone without a second factor, and non-staff with one", async () => {
    expect(await call(owner, "admin_whoami")).toEqual({
      ok: false,
      code: "denied",
      why: "no_second_factor",
    });
    expect(await call(outsider, "admin_whoami")).toEqual({
      ok: false,
      code: "denied",
      why: "not_permitted",
    });

    await secondFactor(owner.client);
    expect(await call(owner, "admin_whoami")).toMatchObject({
      ok: true,
      role: "owner",
      display_name: "First owner",
    });
  });

  it("needs a second person, or a logged emergency, to add staff", async () => {
    const req = await call(owner, "admin_request_change", {
      p_action: "staff.add",
      p_target_type: "staff",
      p_target_id: adminStaff.id,
      p_payload: { role: "admin", display_name: "Admin" },
      p_reason: `Test: add admin ${runId}`,
    });
    const id = req.id as string;
    // Not before approval, and never by approving your own request.
    expect(await call(owner, "admin_apply_staff_change", { p_request_id: id })).toEqual({
      ok: false,
      code: "approval_required",
    });
    expect(
      await call(owner, "admin_decide_change", { p_id: id, p_approve: true, p_note: "" }),
    ).toEqual({ ok: false, code: "own_request" });
    // The only owner: break-glass, recorded as an emergency.
    expect(
      await call(owner, "admin_emergency_approve", {
        p_id: id,
        p_reason: "Only one approver exists in this test",
      }),
    ).toEqual({ ok: true });
    expect(await call(owner, "admin_apply_staff_change", { p_request_id: id })).toEqual({
      ok: true,
    });
    // An approval runs once.
    expect(await call(owner, "admin_apply_staff_change", { p_request_id: id })).toEqual({
      ok: false,
      code: "approval_required",
    });
    expect(await call(adminStaff, "admin_whoami")).toMatchObject({
      ok: true,
      role: "admin",
    });

    // Now a second person approves.
    const add = await staffChange(owner, adminStaff, "staff.add", support, {
      role: "support",
      display_name: "Support",
    });
    expect(add.decided).toEqual({ ok: true });
    expect(add.applied).toEqual({ ok: true });
    // Staff without a second factor still get nothing.
    expect(await call(support, "admin_whoami")).toMatchObject({
      ok: false,
      code: "denied",
    });
    await secondFactor(support.client);
    expect(await call(support, "admin_whoami")).toMatchObject({
      ok: true,
      role: "support",
      permissions: [
        "portal.access",
        "customers.read",
        "customers.status",
        "plans.read",
        "ops.read",
      ],
    });
  });

  it("keeps roles to their permissions", async () => {
    // Support can neither ask for staff changes nor approve them, nor read the trail.
    expect(
      await call(support, "admin_request_change", {
        p_action: "staff.set_role",
        p_target_type: "staff",
        p_target_id: support.id,
        p_payload: { role: "owner" },
        p_reason: "Make me owner please",
      }),
    ).toMatchObject({ ok: false, code: "denied" });
    expect(await call(support, "admin_read_audit")).toMatchObject({
      ok: false,
      code: "denied",
    });
    // Admins can approve but not ask for staff changes.
    expect(
      await call(adminStaff, "admin_request_change", {
        p_action: "staff.set_role",
        p_target_type: "staff",
        p_target_id: adminStaff.id,
        p_payload: { role: "owner" },
        p_reason: "Promote myself",
      }),
    ).toMatchObject({ ok: false, code: "denied" });
  });

  it("keeps staff and customers apart", async () => {
    const join = await admin.from("workspace_members").insert({
      workspace_id: (
        await admin
          .from("workspaces")
          .select("id")
          .eq("slug", `staff-cust-${runId}`)
          .single()
      ).data!.id,
      user_id: adminStaff.id,
      role: "viewer",
    });
    expect(join.error?.message).toContain("staff accounts can't join workspaces");

    const add = await staffChange(owner, adminStaff, "staff.add", customer, {
      role: "support",
      display_name: "Customer",
    });
    expect(add.applied).toMatchObject({ ok: false, code: "error" });
    expect(String(add.applied.message)).toContain("customer workspace");
  });

  it("disabling someone cuts them off at once", async () => {
    const off = await staffChange(owner, "emergency", "staff.disable", adminStaff, {});
    expect(off.applied).toEqual({ ok: true });
    expect(await call(adminStaff, "admin_whoami")).toEqual({
      ok: false,
      code: "denied",
      why: "session_expired",
    });
  });

  it("can't be reached any other way", async () => {
    const asMember = await outsider.client
      .schema("private" as never)
      .from("staff_members")
      .select("*");
    expect(asMember.error).not.toBeNull();
    const withSecretKey = await admin
      .schema("private" as never)
      .from("platform_audit_log")
      .select("*");
    expect(withSecretKey.error).not.toBeNull();
    const verifyAsMember = await outsider.client.rpc("admin_verify_audit_chain");
    expect(verifyAsMember.error).not.toBeNull();
  });

  it("records everything, denials included, in a chain that shows any edit", async () => {
    const trail = await call(owner, "admin_read_audit", { p_limit: 200 });
    const entries = trail.entries as {
      id: number;
      action: string;
      outcome: string;
      actor_user_id: string | null;
    }[];
    const actions = entries.map((e) => `${e.action}:${e.outcome}`);
    expect(actions).toEqual(
      expect.arrayContaining([
        "staff.bootstrap:succeeded",
        "change.emergency_approved:succeeded",
        "change.approved:succeeded",
        "staff.add:succeeded",
        "staff.add:denied",
        "change.decided:denied",
        "staff.disable:succeeded",
        "portal.access:denied",
      ]),
    );
    expect(
      entries.some((e) => e.actor_user_id === outsider.id && e.outcome === "denied"),
    ).toBe(true);

    const whole = await admin.rpc("admin_verify_audit_chain");
    expect(whole.data?.[0].first_broken_id).toBeNull();

    // No one can edit it through the database's own rules…
    expect(() =>
      sql(
        `update private.platform_audit_log set reason = 'edited' where id = ${entries[0].id}`,
      ),
    ).toThrow(/can only be added to/);
    // …and an edit made around them (a superuser disabling the guard) shows.
    const target = entries[entries.length - 1].id;
    const original = sql(
      `select coalesce(reason, '<null>') from private.platform_audit_log where id = ${target}`,
    );
    const restore = original === "<null>" ? "null" : `'${original.replace(/'/g, "''")}'`;
    sql(
      `alter table private.platform_audit_log disable trigger platform_audit_log_insert_only;
       update private.platform_audit_log set reason = 'rewritten' where id = ${target};
       alter table private.platform_audit_log enable trigger platform_audit_log_insert_only;`,
    );
    const broken = await admin.rpc("admin_verify_audit_chain");
    expect(broken.data?.[0].first_broken_id).toBe(target);
    sql(
      `alter table private.platform_audit_log disable trigger platform_audit_log_insert_only;
       update private.platform_audit_log set reason = ${restore} where id = ${target};
       alter table private.platform_audit_log enable trigger platform_audit_log_insert_only;`,
    );
    const fixed = await admin.rpc("admin_verify_audit_chain");
    expect(fixed.data?.[0].first_broken_id).toBeNull();
  });

  it("cuts off a session idle for more than 30 minutes", async () => {
    expect(await call(support, "admin_whoami")).toMatchObject({ ok: true });
    sql(
      `update private.staff_session_activity set last_seen_at = now() - interval '31 minutes'
       where user_id = '${support.id}'`,
    );
    expect(await call(support, "admin_whoami")).toEqual({
      ok: false,
      code: "denied",
      why: "session_idle",
    });
  });
});
