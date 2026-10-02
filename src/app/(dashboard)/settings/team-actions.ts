"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  acceptInvitation,
  canAdmin,
  changeMemberRole,
  createInvitation,
  INVITABLE_ROLES,
  removeMember,
  revokeInvitation,
  TeamError,
  type InvitableRole,
} from "@/domains/workspaces";
import { sendInvitationEmail } from "@/domains/notifications/invite";
import { getCurrentWorkspace, WORKSPACE_COOKIE } from "@/lib/auth/current-workspace";
import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { hitRateLimit } from "@/domains/abuse/shared-rate-limit";

export type TeamResult =
  { ok: true; message?: string; link?: string } | { ok: false; message: string };

const Role = z.enum(INVITABLE_ROLES);

/** Invites someone by email (admins). Sends the link when email is set
 * up; either way the link is returned so it can be shared directly. */
export async function inviteMemberAction(
  email: string,
  role: InvitableRole,
): Promise<TeamResult> {
  const parsedEmail = z.string().trim().email().max(254).safeParse(email);
  if (!parsedEmail.success) return { ok: false, message: "Enter a valid email address." };
  if (!Role.safeParse(role).success) return { ok: false, message: "Choose a role." };
  const { user, workspace } = await getCurrentWorkspace();
  if (!canAdmin(workspace.role)) {
    return { ok: false, message: "Only the owner and admins can invite people." };
  }
  const admin = createAdminClient();
  if (!(await hitRateLimit(admin, `invite:${user.id}`, 30, 3_600_000)).allowed) {
    return { ok: false, message: "That's a lot of invitations. Try again later." };
  }
  try {
    const { path } = await createInvitation(admin, {
      workspaceId: workspace.id,
      email: parsedEmail.data,
      role,
      invitedBy: user.id,
    });
    const link = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}${path}`;
    const sent = await sendInvitationEmail({
      to: parsedEmail.data.toLowerCase(),
      workspaceName: workspace.name,
      inviterName:
        (user.user_metadata?.full_name as string | undefined) || user.email || "",
      role,
      link,
    });
    revalidatePath("/settings");
    return {
      ok: true,
      link,
      message: sent
        ? `Invitation sent to ${parsedEmail.data}.`
        : "Email isn't set up, so share this link with them yourself.",
    };
  } catch (error) {
    if (error instanceof TeamError) return { ok: false, message: error.message };
    return { ok: false, message: "Couldn't create the invitation. Please try again." };
  }
}

export async function changeRoleAction(
  userId: string,
  role: InvitableRole,
): Promise<TeamResult> {
  if (!z.string().uuid().safeParse(userId).success || !Role.safeParse(role).success) {
    return { ok: false, message: "Something's not right with that change." };
  }
  const { supabase, workspace } = await getCurrentWorkspace();
  try {
    await changeMemberRole(supabase, workspace.id, userId, role);
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof TeamError ? error.message : "Couldn't change that.",
    };
  }
}

export async function removeMemberAction(userId: string): Promise<TeamResult> {
  if (!z.string().uuid().safeParse(userId).success)
    return { ok: false, message: "Not found." };
  const { supabase, workspace } = await getCurrentWorkspace();
  try {
    await removeMember(supabase, workspace.id, userId);
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof TeamError ? error.message : "Couldn't remove them.",
    };
  }
}

/** Leaves a workspace you don't own (members can always leave). */
export async function leaveWorkspaceAction(): Promise<TeamResult> {
  const { user, workspace } = await getCurrentWorkspace();
  if (workspace.role === "owner") {
    return { ok: false, message: "The owner can't leave their own workspace." };
  }
  const { error } = await createAdminClient()
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id);
  if (error) return { ok: false, message: "Couldn't leave the workspace." };
  (await cookies()).delete(WORKSPACE_COOKIE);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function revokeInvitationAction(invitationId: string): Promise<TeamResult> {
  if (!z.string().uuid().safeParse(invitationId).success)
    return { ok: false, message: "Not found." };
  const { supabase, workspace } = await getCurrentWorkspace();
  try {
    await revokeInvitation(supabase, workspace.id, invitationId);
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof TeamError ? error.message : "Couldn't cancel it.",
    };
  }
}

/** Accepts an invitation as the signed-in user and opens that workspace. */
export async function acceptInvitationAction(token: string): Promise<TeamResult> {
  const { user } = await requireUser();
  let workspaceId: string;
  try {
    workspaceId = await acceptInvitation(createAdminClient(), token, {
      id: user.id,
      email: user.email,
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof TeamError ? error.message : "Couldn't accept the invitation.",
    };
  }
  (await cookies()).set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
