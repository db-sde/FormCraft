"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deleteAccount } from "@/domains/identity";
import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";

export type AccountResult =
  { ok: true; message?: string } | { ok: false; message: string };

export async function updateNameAction(fullName: string): Promise<AccountResult> {
  const name = fullName.trim();
  if (!name || name.length > 100)
    return { ok: false, message: "Enter a name up to 100 characters." };
  const { supabase, user } = await requireUser();
  const { error } = await supabase.auth.updateUser({ data: { full_name: name } });
  if (error) return { ok: false, message: "Couldn't update your name." };
  await supabase.from("profiles").update({ full_name: name }).eq("id", user.id);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateEmailAction(email: string): Promise<AccountResult> {
  const parsed = z.string().trim().email().max(254).safeParse(email);
  if (!parsed.success) return { ok: false, message: "Enter a valid email address." };
  const { supabase } = await requireUser();
  const { error } = await supabase.auth.updateUser(
    { email: parsed.data },
    {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/confirm?next=/settings`,
    },
  );
  if (error)
    return { ok: false, message: error.message || "Couldn't change your email." };
  return {
    ok: true,
    // Supabase is configured to confirm email changes from both
    // inboxes (double_confirm_changes), so say so — otherwise people click
    // one link, nothing changes, and it looks broken.
    message: `We sent a confirmation link to your current address and one to ${parsed.data}. Your email changes once you've clicked both.`,
  };
}

export async function updatePasswordAction(
  password: string,
  currentPassword?: string,
): Promise<AccountResult> {
  if (password.length < 8) return { ok: false, message: "Use at least 8 characters." };
  const { supabase, user } = await requireUser();
  // Someone at an unlocked laptop shouldn't be able to lock the owner out:
  // the current password has to be right first.
  if (currentPassword !== undefined) {
    const { error: checkError } = await supabase.auth.signInWithPassword({
      email: user.email ?? "",
      password: currentPassword,
    });
    if (checkError) return { ok: false, message: "Your current password isn't right." };
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error)
    return { ok: false, message: error.message || "Couldn't change your password." };
  return { ok: true, message: "Password updated." };
}

export async function renameWorkspaceAction(
  workspaceId: string,
  name: string,
): Promise<AccountResult> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80)
    return { ok: false, message: "Enter a name up to 80 characters." };
  if (!z.string().uuid().safeParse(workspaceId).success)
    return { ok: false, message: "Workspace not found." };
  const { supabase } = await requireUser();
  // Row-level security only lets the owner update a workspace; a
  // non-owner's update matches no rows.
  const { data, error } = await supabase
    .from("workspaces")
    .update({ name: trimmed })
    .eq("id", workspaceId)
    .select("id");
  if (error || !data?.length)
    return { ok: false, message: "Only the workspace owner can rename it." };
  revalidatePath("/", "layout");
  return { ok: true, message: "Workspace renamed." };
}

/** Deletes the signed-in user's account and all their data. Requires
 * typing the account email as confirmation. */
export async function deleteAccountAction(confirmEmail: string): Promise<AccountResult> {
  const { supabase, user } = await requireUser();
  if (confirmEmail.trim().toLowerCase() !== (user.email ?? "").toLowerCase()) {
    return { ok: false, message: "Type your account email exactly to confirm." };
  }
  try {
    await deleteAccount(createAdminClient(), user.id);
  } catch {
    return {
      ok: false,
      message: "Couldn't delete your account. Please try again or contact support.",
    };
  }
  await supabase.auth.signOut();
  redirect("/?account=deleted");
}
