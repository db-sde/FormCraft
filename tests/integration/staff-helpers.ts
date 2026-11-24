import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { totp } from "../totp";

/**
 * Shared set-up for the Super Admin integration tests: staff accounts with
 * real second-factor sessions, and superuser SQL on the local database
 * (staff are global, so each file starts from none).
 */
export const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const admin: SupabaseClient<Database> = createClient<Database>(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
export const sql = (q: string) =>
  execFileSync("psql", [DB_URL, "-tAq", "-v", "ON_ERROR_STOP=1", "-c", q], {
    encoding: "utf8",
  }).trim();

function psqlAvailable(): boolean {
  try {
    execFileSync("psql", ["--version"]);
    return true;
  } catch {
    return false;
  }
}
/** Only against the local database, with psql at hand. */
export const canRunLocally = /127\.0\.0\.1|localhost/.test(url) && psqlAvailable();

export type Person = { id: string; email: string; client: SupabaseClient<Database> };

export async function person(
  name: string,
  runId: string,
  { mfa }: { mfa: boolean },
): Promise<Person> {
  const email = `${name}-${runId}@staff-test.example.com`;
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
    const { data: factor, error } = await client.auth.mfa.enroll({ factorType: "totp" });
    if (error) throw error;
    await client.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: totp(factor.totp.secret),
    });
  }
  return { id: data.user!.id, email, client };
}

export type Result = { ok: boolean; code?: string; why?: string; [k: string]: unknown };

export async function call(p: Person, fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await p.client.rpc(fn as never, args as never);
  if (error) return { ok: false, code: "error", message: error.message } as Result;
  return data as unknown as Result;
}

/** A first owner, plus more staff added through logged emergency approvals. */
export async function staffTeam(
  owner: Person,
  others: { person: Person; role: string }[],
): Promise<void> {
  sql(
    "delete from private.restore_tests; delete from private.change_requests; delete from private.staff_members;",
  );
  await admin.rpc("admin_bootstrap_owner", {
    p_user_id: owner.id,
    p_display_name: "Owner",
  });
  for (const { person: p, role } of others) {
    const req = await call(owner, "admin_request_change", {
      p_action: "staff.add",
      p_target_type: "staff",
      p_target_id: p.id,
      p_payload: { role, display_name: role },
      p_reason: `Test team member (${role})`,
    });
    await call(owner, "admin_emergency_approve", {
      p_id: req.id,
      p_reason: "Setting up the test team",
    });
    await call(owner, "admin_apply_staff_change", { p_request_id: req.id });
  }
}

export function clearStaff() {
  sql(
    "delete from private.restore_tests; delete from private.change_requests; delete from private.staff_members;",
  );
}
