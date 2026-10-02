import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getWorkspacePlan, withinLimit } from "@/domains/billing/entitlements";

type Client = SupabaseClient<Database>;

/**
 * Teams (PRD P2.19). Roles are enforced by row-level security
 * (migration 28: can_edit_workspace / can_admin_workspace); this module
 * holds what needs the server: invitation tokens, seat limits from the
 * plan, and accepting. Invitation tokens are 256 random bits; only their
 * SHA-256 is stored.
 */

export const WORKSPACE_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
export const INVITABLE_ROLES = ["admin", "editor", "viewer"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTION: Record<WorkspaceRole, string> = {
  owner: "Everything, including the workspace itself.",
  admin: "Everything except deleting the workspace: forms, responses, members.",
  editor: "Builds and publishes forms, sees responses.",
  viewer: "Sees forms, responses and analytics; can't change anything.",
};

export const canEdit = (role: string | null | undefined) =>
  role === "owner" || role === "admin" || role === "editor";
export const canAdmin = (role: string | null | undefined) =>
  role === "owner" || role === "admin";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export class TeamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamError";
  }
}

export type TeamMember = {
  userId: string;
  role: WorkspaceRole;
  name: string;
  email: string;
  /** Per-member overrides of the role's permissions (P3.15). */
  permissions: Record<string, boolean>;
};

export type PendingInvitation = {
  id: string;
  email: string;
  role: InvitableRole;
  expiresAt: string;
};

/** Members and open invitations, as the signed-in user sees them (RLS:
 * members read the roster; only admins see invitations). */
export async function listTeam(
  supabase: Client,
  workspaceId: string,
): Promise<{ members: TeamMember[]; invitations: PendingInvitation[] }> {
  const [members, invitations] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("user_id, role, permissions, profiles(full_name, email)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
    supabase
      .from("workspace_invitations")
      .select("id, email, role, expires_at")
      .eq("workspace_id", workspaceId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true }),
  ]);
  if (members.error) throw members.error;
  return {
    members: (members.data ?? []).map((m) => {
      const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      return {
        userId: m.user_id,
        role: m.role as WorkspaceRole,
        name: profile?.full_name ?? "",
        email: profile?.email ?? "",
        permissions: (m.permissions ?? {}) as Record<string, boolean>,
      };
    }),
    invitations: (invitations.data ?? []).map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role as InvitableRole,
      expiresAt: i.expires_at,
    })),
  };
}

/** Seats in use: members plus invitations still open. */
async function seatsTaken(admin: Client, workspaceId: string): Promise<number> {
  const [members, invitations] = await Promise.all([
    admin
      .from("workspace_members")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    admin
      .from("workspace_invitations")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString()),
  ]);
  if (members.error) throw members.error;
  if (invitations.error) throw invitations.error;
  return (members.count ?? 0) + (invitations.count ?? 0);
}

/**
 * Invites someone by email. The caller must already have checked that
 * the inviter is an admin of the workspace (the action does, with the
 * inviter's session). Service-role client.
 */
export async function createInvitation(
  admin: Client,
  input: { workspaceId: string; email: string; role: InvitableRole; invitedBy: string },
): Promise<{ path: string; expiresAt: string }> {
  const email = input.email.trim().toLowerCase();
  const { entitlements } = await getWorkspacePlan(admin, input.workspaceId);
  if (!withinLimit(entitlements, "members", await seatsTaken(admin, input.workspaceId))) {
    throw new TeamError(
      `Your plan includes ${entitlements.members} member${entitlements.members === 1 ? "" : "s"}. Upgrade to invite more.`,
    );
  }
  const { data: existing } = await admin
    .from("workspace_members")
    .select("user_id, profiles!inner(email)")
    .eq("workspace_id", input.workspaceId)
    .eq("profiles.email", email)
    .maybeSingle();
  if (existing) throw new TeamError(`${email} is already in this workspace.`);

  const token = randomBytes(32).toString("base64url");
  const { data, error } = await admin
    .from("workspace_invitations")
    .insert({
      workspace_id: input.workspaceId,
      email,
      role: input.role,
      token_hash: hash(token),
      invited_by: input.invitedBy,
    })
    .select("expires_at")
    .single();
  if (error) {
    if (error.code === "23505")
      throw new TeamError(`${email} already has an invitation.`);
    throw error;
  }
  return { path: `/invite/${token}`, expiresAt: data.expires_at };
}

export type InvitationPreview = {
  workspaceName: string;
  role: InvitableRole;
  email: string;
};

async function findInvitation(admin: Client, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { data } = await admin
    .from("workspace_invitations")
    .select(
      "id, workspace_id, email, role, expires_at, accepted_at, revoked_at, workspaces(name)",
    )
    .eq("token_hash", hash(token))
    .maybeSingle();
  if (!data || data.accepted_at || data.revoked_at) return null;
  if (new Date(data.expires_at) <= new Date()) return null;
  return data;
}

/** What an invitation link is for, or null if it doesn't work. */
export async function previewInvitation(
  admin: Client,
  token: string,
): Promise<InvitationPreview | null> {
  const invitation = await findInvitation(admin, token);
  if (!invitation) return null;
  return {
    workspaceName:
      (invitation.workspaces as { name: string } | null)?.name ?? "a workspace",
    role: invitation.role as InvitableRole,
    email: invitation.email,
  };
}

/**
 * Accepts an invitation for the signed-in user. Their account email
 * must be the invited address — a forwarded link can't be used by
 * someone else. Re-checks the seat limit. Returns the workspace id.
 */
export async function acceptInvitation(
  admin: Client,
  token: string,
  user: { id: string; email: string | undefined },
): Promise<string> {
  const invitation = await findInvitation(admin, token);
  if (!invitation)
    throw new TeamError("This invitation has expired or was already used.");
  if ((user.email ?? "").toLowerCase() !== invitation.email) {
    throw new TeamError(
      `This invitation is for ${invitation.email}. Sign in with that address to accept it.`,
    );
  }
  const { data: member } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", invitation.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) {
    // The invitation itself holds a seat, so accepting doesn't need one more.
    const { entitlements } = await getWorkspacePlan(admin, invitation.workspace_id);
    if (
      !withinLimit(
        entitlements,
        "members",
        await seatsTaken(admin, invitation.workspace_id),
        0,
      )
    ) {
      throw new TeamError("This workspace has no seats left. Ask its owner to upgrade.");
    }
    const { error } = await admin.from("workspace_members").insert({
      workspace_id: invitation.workspace_id,
      user_id: user.id,
      role: invitation.role as InvitableRole,
    });
    if (error) throw error;
  }
  await admin
    .from("workspace_invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invitation.id);
  return invitation.workspace_id;
}

/** Changes a member's role, as the signed-in admin (RLS + the owner
 * trigger decide; a refusal comes back as a TeamError). */
export async function changeMemberRole(
  supabase: Client,
  workspaceId: string,
  userId: string,
  role: InvitableRole,
): Promise<void> {
  const { data, error } = await supabase
    .from("workspace_members")
    .update({ role })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .select("id");
  if (error)
    throw new TeamError(
      error.message.includes("owner") ? error.message : "Couldn't change that role.",
    );
  if (!data?.length) throw new TeamError("Only admins can change roles.");
}

export async function removeMember(
  supabase: Client,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .select("id");
  if (error)
    throw new TeamError(
      error.message.includes("owner") ? error.message : "Couldn't remove them.",
    );
  if (!data?.length) throw new TeamError("Only admins can remove members.");
}

export async function revokeInvitation(
  supabase: Client,
  workspaceId: string,
  invitationId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("workspace_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", invitationId)
    .select("id");
  if (error || !data?.length) throw new TeamError("Couldn't cancel that invitation.");
}
