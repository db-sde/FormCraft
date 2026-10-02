import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import {
  ensureDefaultWorkspace,
  listWorkspacesForCurrentUser,
} from "@/domains/workspaces";
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
