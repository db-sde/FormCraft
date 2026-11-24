"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { rateLimit } from "@/domains/abuse/limit";
import { getClientIpFromHeaders } from "@/lib/http/client-ip";
import { adminSurfaceEnabled } from "@/lib/admin/surface";
import { adminCall, type AdminResult } from "@/lib/admin/staff";

/**
 * Super Admin portal actions. Each one is a thin call: the database
 * function behind it decides who may do what (private.check_staff), so
 * nothing here is the security boundary — it only shapes the messages.
 */

export type FormState = { error?: string; ok?: string };

const NOT_HERE = "Not available.";
const TOO_MANY = "Too many attempts. Wait a few minutes and try again.";

const SignIn = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

/** Step one: email and password (staff-only accounts). */
export async function staffSignInAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  if (!adminSurfaceEnabled()) return { error: NOT_HERE };
  const parsed = SignIn.safeParse({
    email: form.get("email"),
    password: form.get("password"),
  });
  // One message for every failure: nothing says whether an account exists.
  const wrong = { error: "That email and password don't match a staff account." };
  if (!parsed.success) return wrong;
  const ip = await getClientIpFromHeaders();
  if (
    !(await rateLimit(`admin-login:${ip}`, 20, 60 * 60 * 1000)).allowed ||
    !(await rateLimit(`admin-login:${parsed.data.email}`, 8, 60 * 60 * 1000)).allowed
  ) {
    return { error: TOO_MANY };
  }
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return wrong;
  redirect("/admin/two-factor");
}

async function signedIn() {
  if (!adminSurfaceEnabled()) redirect("/admin/login");
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");
  const ip = await getClientIpFromHeaders();
  const allowed =
    (await rateLimit(`admin-mfa:${user.id}`, 10, 10 * 60 * 1000)).allowed &&
    (await rateLimit(`admin-mfa-ip:${ip}`, 30, 10 * 60 * 1000)).allowed;
  return { supabase, user, allowed };
}

/** Sets up an authenticator for a staff account that has none yet. */
export async function startAuthenticatorAction(): Promise<
  | { ok: true; factorId: string; qr: string; secret: string }
  | { ok: false; error: string }
> {
  const { supabase, allowed } = await signedIn();
  if (!allowed) return { ok: false, error: TOO_MANY };
  const { data: factors } = await supabase.auth.mfa.listFactors();
  if (factors?.totp?.some((f) => f.status === "verified")) {
    return { ok: false, error: "This account already has an authenticator." };
  }
  for (const f of factors?.all ?? []) {
    if (f.factor_type === "totp" && f.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "FormCraft staff",
  });
  if (error || !data) return { ok: false, error: "Couldn't start. Try again." };
  return { ok: true, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** The code from the authenticator: completes sign-in, set-up, or a
 * fresh check before a high-risk action. */
export async function verifyCodeAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code from your app." };
  const { supabase, allowed } = await signedIn();
  if (!allowed) return { error: TOO_MANY };
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const requested = String(form.get("factorId") ?? "");
  const factor =
    factors?.totp?.find((f) => f.status === "verified") ??
    factors?.all?.find((f) => f.id === requested && f.factor_type === "totp");
  if (!factor) return { error: "Set up an authenticator first." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code,
  });
  if (error) return { error: "That code didn't work. Codes change every 30 seconds." };
  const next = String(form.get("next") ?? "");
  redirect(/^\/admin(\/[\w\-/]*)?$/.test(next) ? next : "/admin");
}

export async function staffSignOutAction(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}

// --- approvals and staff changes ------------------------------------------

export type ActionResult =
  { ok: true; message?: string } | { ok: false; error: string; why?: string };

function explain(result: AdminResult, fallback: string): ActionResult {
  if (result.ok) return { ok: true };
  const messages: Record<string, string> = {
    step_up_required: "Enter a fresh code from your authenticator first.",
    session_idle: "Your session timed out. Sign in again.",
    session_expired: "Your session ended. Sign in again.",
    no_second_factor: "Sign in with your authenticator first.",
    own_request: "Someone else has to approve your own request.",
    approval_required: "This needs an approved request first.",
    expired: "This request expired. Ask again.",
    not_pending: "This request was already decided.",
    reason_required: "Give a reason.",
    not_found: "That request no longer exists.",
  };
  const key = result.why && result.why !== "not_permitted" ? result.why : result.code;
  return {
    ok: false,
    error: messages[key] ?? (result.code === "denied" ? "You can't do this." : fallback),
    why: result.why,
  };
}

const StaffChange = z.object({
  action: z.enum(["staff.add", "staff.set_role", "staff.disable"]),
  email: z.string().trim().toLowerCase().email().max(254),
  role: z
    .enum(["owner", "admin", "support", "billing", "privacy", "read_only"])
    .optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
  reason: z.string().trim().min(5).max(500),
});

export async function requestStaffChangeAction(input: unknown): Promise<ActionResult> {
  const parsed = StaffChange.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Fill in every field (a reason of 5+ characters)." };
  const { action, email, role, displayName, reason } = parsed.data;
  const found = await adminCall<{ user_id: string; customer: boolean; staff: boolean }>(
    "admin_find_account",
    { p_email: email },
  );
  if (!found.ok) return explain(found, "No account with that email. They sign up first.");
  if (action === "staff.add" && found.customer) {
    return {
      ok: false,
      error: "That account uses FormCraft as a customer. Use a staff-only account.",
    };
  }
  if (action === "staff.add" && found.staff)
    return { ok: false, error: "They're already staff." };
  if (action !== "staff.add" && !found.staff)
    return { ok: false, error: "They aren't staff." };
  if (action !== "staff.disable" && !role) return { ok: false, error: "Choose a role." };
  const payload =
    action === "staff.add"
      ? { role, display_name: displayName ?? email.split("@")[0] }
      : action === "staff.set_role"
        ? { role }
        : {};
  const result = await adminCall("admin_request_change", {
    p_action: action,
    p_target_type: "staff",
    p_target_id: found.user_id,
    p_payload: payload,
    p_reason: reason,
  });
  revalidatePath("/admin/approvals");
  return explain(result, "Couldn't file the request.");
}

const Decision = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approve", "reject", "apply", "emergency"]),
  /** Which kind of change, to pick the function that carries it out (the
   * database checks it matches the request). */
  action: z.string().max(40).optional(),
  note: z.string().trim().max(500).optional(),
});

export async function decideAction(input: unknown): Promise<ActionResult> {
  const parsed = Decision.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { id, decision, note, action } = parsed.data;
  const result =
    decision === "apply"
      ? await adminCall(
          action?.startsWith("staff.")
            ? "admin_apply_staff_change"
            : "admin_apply_change",
          { p_request_id: id },
        )
      : decision === "emergency"
        ? await adminCall("admin_emergency_approve", { p_id: id, p_reason: note ?? "" })
        : await adminCall("admin_decide_change", {
            p_id: id,
            p_approve: decision === "approve",
            p_note: note ?? "",
          });
  revalidatePath("/admin/approvals");
  revalidatePath("/admin/staff");
  revalidatePath("/admin/customers", "layout");
  revalidatePath("/admin/plans");
  return explain(result, "That didn't work. Try again.");
}

// --- customers and plans (Phase 1) --------------------------------------------

const WorkspaceChange = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("workspace.status"),
    workspaceId: z.string().uuid(),
    status: z.enum(["active", "restricted", "suspended"]),
    message: z.string().trim().max(500).optional(),
    reason: z.string().trim().min(5).max(500),
  }),
  z.object({
    action: z.literal("workspace.plan"),
    workspaceId: z.string().uuid(),
    planId: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
    overrides: z.string().max(4000),
    reason: z.string().trim().min(5).max(500),
  }),
]);

/** Asks for a status or plan change for one workspace (approved by
 * someone else on Approvals). */
export async function requestWorkspaceChangeAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = WorkspaceChange.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Fill in every field (a reason of 5+ characters)." };
  const v = parsed.data;
  let payload: Record<string, unknown>;
  if (v.action === "workspace.status") {
    payload = { status: v.status, ...(v.message ? { message: v.message } : {}) };
  } else {
    let overrides: unknown;
    try {
      overrides = v.overrides.trim() ? JSON.parse(v.overrides) : {};
    } catch {
      return {
        ok: false,
        error: 'Overrides must be a JSON object, like {"members": 5}.',
      };
    }
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
      return { ok: false, error: "Overrides must be a JSON object." };
    }
    payload = { plan_id: v.planId, overrides };
  }
  const result = await adminCall("admin_request_change", {
    p_action: v.action,
    p_target_type: "workspace",
    p_target_id: v.workspaceId,
    p_payload: payload,
    p_reason: v.reason,
  });
  revalidatePath(`/admin/customers/${v.workspaceId}`);
  return explain(result, "Couldn't file the request.");
}

const PlanChange = z.object({
  planId: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  entitlements: z.string().max(8000),
  reason: z.string().trim().min(5).max(500),
});

/** Asks for a change to a plan's entitlements (every workspace on it). */
export async function requestPlanChangeAction(input: unknown): Promise<ActionResult> {
  const parsed = PlanChange.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Fill in every field (a reason of 5+ characters)." };
  let entitlements: unknown;
  try {
    entitlements = JSON.parse(parsed.data.entitlements);
  } catch {
    return { ok: false, error: "Entitlements must be a JSON object." };
  }
  if (!entitlements || typeof entitlements !== "object" || Array.isArray(entitlements)) {
    return { ok: false, error: "Entitlements must be a JSON object." };
  }
  const result = await adminCall("admin_request_change", {
    p_action: "plan.update",
    p_target_type: "plan",
    p_target_id: parsed.data.planId,
    p_payload: { entitlements },
    p_reason: parsed.data.reason,
  });
  revalidatePath("/admin/plans");
  return explain(result, "Couldn't file the request.");
}
