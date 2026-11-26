import { currentRequestId } from "@/lib/http/request-id";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * Audit log (PRD P3.14): security and admin actions — who, what, on
 * what, when — with non-sensitive metadata only (ids, names, roles;
 * never answers, tokens or keys). Writing never throws and never blocks
 * the action it records. Service-role client.
 */

export type AuditAction =
  | "form.published"
  | "form.unpublished"
  | "form.deleted"
  | "form.archived"
  | "form.restored"
  | "form.seo_changed"
  | "brand_theme.saved"
  | "brand_theme.deleted"
  | "email_template.saved"
  | "email_template.reset"
  | "billing.checkout_started"
  | "billing.subscription_changed"
  | "billing.subscription_cancelled"
  | "feature_flag.changed"
  | "form.version_restored"
  | "form.availability_changed"
  | "form.password_set"
  | "form.password_removed"
  | "form.captcha_changed"
  | "form.kiosk_changed"
  | "response.deleted"
  | "support.status_changed"
  | "support.plan_changed"
  | "response.answer_corrected"
  | "payment.refunded"
  | "template.created"
  | "template.deleted"
  | "block.created"
  | "block.version_published"
  | "block.restored"
  | "block.archived"
  | "experiment.started"
  | "experiment.stopped"
  | "member.invited"
  | "member.joined"
  | "member.role_changed"
  | "member.removed"
  | "member.left"
  | "invitation.revoked"
  | "integration.connected"
  | "integration.disconnected"
  | "integration.secret_rotated"
  | "api_key.created"
  | "api_key.revoked"
  | "api.hook_created"
  | "api.hook_deleted"
  | "domain.added"
  | "domain.verified"
  | "domain.removed"
  | "export.responses"
  | "export.leads"
  | "plan.changed"
  | "retention.changed"
  | "retention.purged"
  | "permissions.changed"
  | "security.sso_changed"
  | "security.scim_token_created"
  | "security.scim_token_revoked"
  | "privacy.data_exported"
  | "privacy.data_deleted"
  | "security.mfa_enabled"
  | "security.mfa_disabled"
  | "security.recovery_code_used";

export type AuditEntry = {
  workspaceId: string;
  actorId: string | null;
  action: AuditAction;
  target?: { type: string; id: string };
  metadata?: Record<string, string | number | boolean | null>;
  /** Why it was done, in the person's own words (a plan override, a
   * privacy erasure). Never answers or secrets. */
  reason?: string | null;
  /** How it went: refused and failed attempts are worth recording too. */
  outcome?: "succeeded" | "failed" | "denied";
  /** The request that did it; the current one when left out. */
  requestId?: string | null;
};

export async function audit(admin: Client, entry: AuditEntry): Promise<void> {
  try {
    const requestId =
      entry.requestId === undefined ? await currentRequestId() : entry.requestId;
    await admin.from("audit_logs").insert({
      workspace_id: entry.workspaceId,
      actor_id: entry.actorId,
      action: entry.action,
      target_type: entry.target?.type ?? null,
      target_id: entry.target?.id ?? null,
      metadata: (entry.metadata ?? {}) as Json,
      reason: entry.reason?.trim().slice(0, 500) || null,
      outcome: entry.outcome ?? "succeeded",
      request_id: requestId,
    });
  } catch {
    // An audit write must never break the action it records.
  }
}

export type AuditRecord = {
  id: number;
  action: string;
  actorName: string | null;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  reason: string | null;
  outcome: string;
  requestId: string | null;
  createdAt: string;
};

/** Newest first, 50 at a time; pass the last id to page back. */
export async function listAuditLog(
  supabase: Client,
  workspaceId: string,
  before?: number,
): Promise<AuditRecord[]> {
  let query = supabase
    .from("audit_logs")
    .select(
      "id, action, target_type, target_id, metadata, reason, outcome, request_id, created_at, profiles(full_name, email)",
    )
    .eq("workspace_id", workspaceId)
    .order("id", { ascending: false })
    .limit(50);
  if (before) query = query.lt("id", before);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => {
    const actor = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: row.id,
      action: row.action,
      actorName: actor?.full_name ?? null,
      actorEmail: actor?.email ?? null,
      targetType: row.target_type,
      targetId: row.target_id,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      reason: row.reason,
      outcome: row.outcome,
      requestId: row.request_id,
      createdAt: row.created_at,
    };
  });
}
