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
    not_verified: "Record how you checked the person's identity first.",
    daily_limit: "Five notices started in the last day. Wait before sending another.",
    "request does not match": "The approved request doesn't match this one any more.",
    "notice does not match": "The approved wording doesn't match this notice any more.",
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
            : action?.startsWith("ai.")
              ? "admin_apply_ai_change"
              : action?.startsWith("privacy.")
                ? "admin_apply_privacy_erasure"
                : action?.startsWith("message.")
                  ? "admin_apply_message_send"
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
  revalidatePath("/admin/ai");
  revalidatePath("/admin/privacy", "layout");
  revalidatePath("/admin/messages");
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

const RestoreTest = z.object({
  backupTime: z.string().max(40).nullable(),
  restoredTo: z.string().trim().min(2).max(200),
  checks: z.string().trim().min(5).max(2000),
  evidenceUrl: z.string().trim().url().startsWith("https://").max(500).nullable(),
  succeeded: z.boolean(),
});

/** Records a restore drill (ADM-077). */
export async function recordRestoreTestAction(input: unknown): Promise<ActionResult> {
  const parsed = RestoreTest.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Say where it was restored and what was checked (links must be https).",
    };
  }
  const v = parsed.data;
  const backupTime = v.backupTime ? new Date(v.backupTime) : null;
  const result = await adminCall("admin_record_restore_test", {
    p_backup_time:
      backupTime && !Number.isNaN(backupTime.getTime()) ? backupTime.toISOString() : null,
    p_restored_to: v.restoredTo,
    p_checks: v.checks,
    p_evidence_url: v.evidenceUrl,
    p_succeeded: v.succeeded,
  });
  revalidatePath("/admin/operations");
  return explain(result, "Couldn't record it.");
}

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

// --- AI (Phase 3) -------------------------------------------------------------

const AI_SETTING_TARGETS = [
  "*",
  "form_generate",
  "form_edit",
  "logic_rule",
  "form_review",
  "response_analysis",
  "response_summary",
  "follow_up",
] as const;

const AiChange = z.object({
  feature: z.enum(AI_SETTING_TARGETS),
  /** "keep" leaves a setting as it is. */
  enabled: z.enum(["keep", "on", "off"]),
  model: z.enum([
    "keep",
    "default",
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
  ]),
  maxTokens: z.string().trim().max(10),
  ceilingUsd: z.string().trim().max(10),
  reason: z.string().trim().min(5).max(500),
});

/** Asks for a change to an AI setting (approved by someone else). The
 * database checks the values again when the change is carried out. */
export async function requestAiChangeAction(input: unknown): Promise<ActionResult> {
  const parsed = AiChange.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Fill in every field (a reason of 5+ characters)." };
  const v = parsed.data;
  const payload: Record<string, unknown> = {};
  if (v.enabled !== "keep") payload.enabled = v.enabled === "on";
  if (v.model === "default") {
    if (v.feature === "*")
      return { ok: false, error: "The platform needs a default model." };
    payload.model = null;
  } else if (v.model !== "keep") payload.model = v.model;
  if (v.maxTokens === "none") payload.max_tokens = null;
  else if (v.maxTokens) {
    const n = Number(v.maxTokens);
    if (!Number.isInteger(n) || n < 256 || n > 32000)
      return { ok: false, error: "Max tokens must be a whole number from 256 to 32000." };
    payload.max_tokens = n;
  }
  if (v.ceilingUsd) {
    if (v.feature !== "*")
      return { ok: false, error: "The ceiling is a platform setting." };
    const n = Number(v.ceilingUsd);
    if (!Number.isFinite(n) || n < 1 || n > 100_000)
      return { ok: false, error: "The ceiling must be between $1 and $100,000 a day." };
    payload.daily_ceiling_usd = n;
  }
  if (Object.keys(payload).length === 0) return { ok: false, error: "Change something." };
  const result = await adminCall("admin_request_change", {
    p_action: "ai.settings",
    p_target_type: "ai_setting",
    p_target_id: v.feature,
    p_payload: payload,
    p_reason: v.reason,
  });
  revalidatePath("/admin/ai");
  revalidatePath("/admin/approvals");
  return explain(result, "Couldn't file the request.");
}

/** Turns AI off for every customer at once. */
export async function pauseAiAction(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ reason: z.string().trim().min(5).max(500) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give a reason (5+ characters)." };
  const result = await adminCall("admin_ai_pause", { p_reason: parsed.data.reason });
  revalidatePath("/admin/ai");
  return explain(result, "Couldn't pause AI.");
}

// --- privacy requests (Phase 4) ----------------------------------------------

const PrivacyOpen = z.object({
  type: z.enum(["access", "erasure", "rectification"]),
  email: z.string().trim().toLowerCase().email().max(254),
  receivedAt: z.string().max(40).nullable(),
  note: z.string().trim().max(2000),
});

/** Logs a request as it arrived; the 30-day deadline runs from then. */
export async function openPrivacyRequestAction(
  input: unknown,
): Promise<ActionResult & { id?: string }> {
  const parsed = PrivacyOpen.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Choose a type and enter a valid email." };
  const v = parsed.data;
  const received = v.receivedAt ? new Date(v.receivedAt) : null;
  const result = await adminCall<{ id: string }>("admin_privacy_open", {
    p_type: v.type,
    p_email: v.email,
    p_received_at:
      received && !Number.isNaN(received.getTime()) ? received.toISOString() : null,
    p_note: v.note,
  });
  revalidatePath("/admin/privacy");
  if (result.ok) return { ok: true, id: result.id };
  return explain(result, "Couldn't log the request.");
}

const Id = z.object({ id: z.string().uuid() });

export async function verifyPrivacyAction(input: unknown): Promise<ActionResult> {
  const parsed = Id.extend({ note: z.string().trim().min(5).max(500) }).safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Say how you checked (5+ characters)." };
  const result = await adminCall("admin_privacy_verify", {
    p_id: parsed.data.id,
    p_note: parsed.data.note,
  });
  revalidatePath(`/admin/privacy/${parsed.data.id}`);
  return explain(result, "Couldn't record it.");
}

export async function findPrivacyAction(input: unknown): Promise<ActionResult> {
  const parsed = Id.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const result = await adminCall("admin_privacy_find", { p_id: parsed.data.id });
  revalidatePath(`/admin/privacy/${parsed.data.id}`);
  return explain(result, "Couldn't search.");
}

/** The person's data as JSON, for the staff member to send them. */
export async function exportPrivacyAction(
  input: unknown,
): Promise<{ ok: true; json: string } | { ok: false; error: string; why?: string }> {
  const parsed = Id.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const result = await adminCall<{ export: unknown }>("admin_privacy_export", {
    p_id: parsed.data.id,
  });
  if (!result.ok) {
    const e = explain(result, "Couldn't export.");
    return e.ok ? { ok: false, error: "Couldn't export." } : e;
  }
  return { ok: true, json: JSON.stringify(result.export, null, 2) };
}

/** Asks for the erasure; someone else approves it on Approvals. */
export async function requestErasureAction(input: unknown): Promise<ActionResult> {
  const parsed = Id.extend({
    email: z.string().trim().toLowerCase().email().max(254),
    reason: z.string().trim().min(5).max(500),
  }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give a reason (5+ characters)." };
  const result = await adminCall("admin_request_change", {
    p_action: "privacy.erase",
    p_target_type: "privacy_request",
    p_target_id: parsed.data.id,
    p_payload: { email: parsed.data.email },
    p_reason: parsed.data.reason,
  });
  revalidatePath(`/admin/privacy/${parsed.data.id}`);
  revalidatePath("/admin/approvals");
  return explain(result, "Couldn't file the request.");
}

export async function closePrivacyAction(input: unknown): Promise<ActionResult> {
  const parsed = Id.extend({
    status: z.enum(["completed", "rejected"]),
    note: z.string().trim().min(5).max(2000),
  }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Say what was done (5+ characters)." };
  const result = await adminCall("admin_privacy_close", {
    p_id: parsed.data.id,
    p_status: parsed.data.status,
    p_note: parsed.data.note,
  });
  revalidatePath("/admin/privacy", "layout");
  return explain(result, "Couldn't close it.");
}

// --- customer notices (Phase 4) ----------------------------------------------

const Draft = z.object({
  kind: z.enum(["incident", "billing", "policy", "service"]),
  subject: z.string().trim().min(3).max(150),
  body: z.string().trim().min(10).max(5000),
  audience: z.enum(["all", "plans", "workspaces"]),
  plans: z.string().max(500),
  workspaceIds: z.string().max(20_000),
});

/** Writes a notice and says how many owners it would reach. */
export async function draftNoticeAction(
  input: unknown,
): Promise<ActionResult & { recipients?: number }> {
  const parsed = Draft.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "A subject (3–150 characters) and a message (10+)." };
  const v = parsed.data;
  if (/[\r\n]/.test(v.subject)) return { ok: false, error: "The subject is one line." };
  const list = (text: string) =>
    text
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
  const audience =
    v.audience === "all"
      ? { type: "all" }
      : v.audience === "plans"
        ? { type: "plans", plans: list(v.plans) }
        : { type: "workspaces", ids: list(v.workspaceIds) };
  const result = await adminCall<{ id: string; recipients: number }>(
    "admin_message_draft",
    {
      p_kind: v.kind,
      p_subject: v.subject,
      p_body: v.body,
      p_audience: audience,
    },
  );
  revalidatePath("/admin/messages");
  if (result.ok) return { ok: true, recipients: result.recipients };
  if (result.code === "invalid" && result.why)
    return { ok: false, error: `Check the audience: ${result.why}.` };
  return explain(result, "Couldn't save the notice.");
}

type Notice = {
  id: string;
  kind: string;
  subject: string;
  body: string;
  audience: unknown;
  status: string;
};

/** Asks to send a notice exactly as written; the approval binds the
 * wording and the audience. */
export async function requestNoticeSendAction(input: unknown): Promise<ActionResult> {
  const parsed = Id.extend({ reason: z.string().trim().min(5).max(500) }).safeParse(
    input,
  );
  if (!parsed.success) return { ok: false, error: "Give a reason (5+ characters)." };
  const list = await adminCall<{ messages: Notice[] }>("admin_message_list");
  if (!list.ok) return explain(list, "Couldn't load the notice.");
  const m = list.messages.find((x) => x.id === parsed.data.id);
  if (!m || m.status !== "draft")
    return { ok: false, error: "Only a draft can be sent." };
  const result = await adminCall("admin_request_change", {
    p_action: "message.send",
    p_target_type: "message",
    p_target_id: m.id,
    p_payload: { kind: m.kind, subject: m.subject, body: m.body, audience: m.audience },
    p_reason: parsed.data.reason,
  });
  revalidatePath("/admin/messages");
  revalidatePath("/admin/approvals");
  return explain(result, "Couldn't file the request.");
}

export async function cancelNoticeAction(input: unknown): Promise<ActionResult> {
  const parsed = Id.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const result = await adminCall("admin_message_cancel", { p_id: parsed.data.id });
  revalidatePath("/admin/messages");
  return explain(result, "Couldn't cancel it.");
}

// --- hardening (Phase 5) -----------------------------------------------------

/** Records the monthly access review: every active staff member looked at. */
export async function recordAccessReviewAction(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({
      reviewed: z.array(z.string().uuid()).max(200),
      notes: z.string().trim().max(2000),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid review." };
  const result = await adminCall("admin_record_access_review", {
    p_reviewed: parsed.data.reviewed,
    p_notes: parsed.data.notes,
  });
  revalidatePath("/admin/staff", "layout");
  if (!result.ok && result.why === "review_incomplete")
    return {
      ok: false,
      error: "Tick every active staff member to confirm you reviewed them.",
    };
  return explain(result, "Couldn't record the review.");
}

const Drill = z.object({
  kind: z.enum([
    "webhook_outage",
    "email_outage",
    "scheduler_outage",
    "ai_outage",
    "staff_lockout",
    "secret_rotation",
    "incident_exercise",
  ]),
  scenario: z.string().trim().min(5).max(1000),
  outcome: z.string().trim().min(5).max(2000),
  succeeded: z.boolean(),
  followUps: z.string().trim().max(2000),
  evidenceUrl: z.string().trim().url().startsWith("https://").max(500).nullable(),
});

/** Records an outage, lockout or incident drill. */
export async function recordDrillAction(input: unknown): Promise<ActionResult> {
  const parsed = Drill.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: "Say what was tried and what happened (links must be https).",
    };
  const v = parsed.data;
  const result = await adminCall("admin_record_drill", {
    p_kind: v.kind,
    p_scenario: v.scenario,
    p_outcome: v.outcome,
    p_succeeded: v.succeeded,
    p_follow_ups: v.followUps,
    p_evidence_url: v.evidenceUrl,
  });
  revalidatePath("/admin/operations");
  return explain(result, "Couldn't record the drill.");
}
