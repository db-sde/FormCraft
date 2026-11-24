import "server-only";
import { notFound, redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { adminSurfaceEnabled } from "./surface";

export type StaffPermission =
  | "portal.access"
  | "customers.read"
  | "customers.status"
  | "plans.read"
  | "plans.change"
  | "ai.settings"
  | "privacy.manage"
  | "comms.send"
  | "ops.read"
  | "ops.record"
  | "staff.manage"
  | "approvals.decide"
  | "audit.read";

export type Staff = {
  role: string;
  displayName: string;
  permissions: StaffPermission[];
};

/** What an admin_* function answers. `why` says what the gate wanted
 * (a fresh code, a new sign-in, a permission). */
export type AdminResult<T = Record<string, unknown>> =
  ({ ok: true } & T) | { ok: false; code: string; why?: string };

/**
 * The staff member behind this request, for portal pages. This only
 * decides where to send someone: every read and write is checked again
 * by the database (private.check_staff), which is the real gate.
 */
export async function requireStaff(permission?: StaffPermission) {
  if (!adminSurfaceEnabled()) notFound();
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") redirect("/admin/two-factor");

  const { data } = await supabase.rpc("admin_whoami");
  const me = data as unknown as AdminResult<{
    role: string;
    display_name: string;
    permissions: StaffPermission[];
  }>;
  if (!me.ok) {
    if (me.why === "session_idle" || me.why === "session_expired") {
      await supabase.auth.signOut();
      redirect("/admin/login?expired=1");
    }
    redirect("/admin/no-access");
  }
  const staff: Staff = {
    role: me.role,
    displayName: me.display_name,
    permissions: me.permissions,
  };
  if (permission && !staff.permissions.includes(permission)) redirect("/admin");
  return { supabase, staff };
}

/** Calls an admin_* function as the signed-in staff member. */
export async function adminCall<T = Record<string, unknown>>(
  fn: string,
  args: Record<string, unknown> = {},
): Promise<AdminResult<T>> {
  if (!adminSurfaceEnabled()) return { ok: false, code: "not_found" };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) return { ok: false, code: "error" };
  return data as unknown as AdminResult<T>;
}
