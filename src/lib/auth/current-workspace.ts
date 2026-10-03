import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import {
  ensureDefaultWorkspace,
  listWorkspacesForCurrentUser,
} from "@/domains/workspaces";
import { redirect } from "next/navigation";
import { workspacesNeedingSso } from "@/domains/identity/sso";
import { requireUser } from "./require-user";

/** Which of the user's workspaces they're working in (set by the
 * workspace switcher). Only a preference: membership is re-checked on
 * every request, and RLS scopes every query regardless. */
export const WORKSPACE_COOKIE = "fc_workspace";

/** Dedupes within a single request (React `cache`) so layout + page
 * both calling this only hit the DB once. */
export const getCurrentWorkspace = cache(async () => {
  const { supabase, user } = await requireUser();
  const fullName = (user.user_metadata?.full_name as string | undefined) ?? null;
  const workspaces = await listWorkspacesForCurrentUser(supabase);
  // Their only workspaces require SSO (P3.12) and this isn't an SSO
  // session: send them to sign in that way instead of quietly creating
  // an empty personal workspace.
  if (workspaces.length === 0 && (await workspacesNeedingSso(supabase)) > 0) {
    redirect("/login/sso?notice=required");
  }
  const chosen = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const workspace =
    workspaces.find((w) => w.id === chosen) ??
    workspaces[0] ??
    (await ensureDefaultWorkspace(supabase, fullName));
  return {
    supabase,
    user,
    workspace,
    workspaces: workspaces.length ? workspaces : [workspace],
  };
});
