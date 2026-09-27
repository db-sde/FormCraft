import "server-only";
import { cache } from "react";
import { ensureDefaultWorkspace } from "@/domains/workspaces";
import { requireUser } from "./require-user";

/** Dedupes within a single request (React `cache`) so layout + page
 * both calling this only hit the DB once. */
export const getCurrentWorkspace = cache(async () => {
  const { supabase, user } = await requireUser();
  const fullName = (user.user_metadata?.full_name as string | undefined) ?? null;
  const workspace = await ensureDefaultWorkspace(supabase, fullName);
  return { supabase, user, workspace };
});
