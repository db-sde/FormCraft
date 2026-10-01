import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  THEME_ASSETS_BUCKET,
  removeFolder,
  removeUploadFiles,
} from "@/domains/uploads/cleanup";

type Client = SupabaseClient<Database>;

/**
 * Permanently deletes a user and everything they own (PRD P1.1 account
 * deletion, §13): the files respondents uploaded to their forms and the
 * logos/backgrounds they uploaded (storage isn't covered by the
 * database cascade), their workspaces — which cascade to forms,
 * versions, responses, answers, integrations and analytics — then the
 * auth user (cascading their profile and memberships). Files go first:
 * if deleting them fails the account is still intact and the call can
 * simply be retried. Service-role client only.
 */
export async function deleteAccount(admin: Client, userId: string): Promise<void> {
  const { data: workspaces, error: workspacesError } = await admin
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId);
  if (workspacesError) throw workspacesError;
  const workspaceIds = (workspaces ?? []).map((w) => w.id);

  if (workspaceIds.length > 0) {
    // Every form id, however many (paged by id — a single select stops
    // at 1000).
    const formIds: string[] = [];
    for (let cursor: string | null = null; ;) {
      let query = admin
        .from("forms")
        .select("id")
        .in("workspace_id", workspaceIds)
        .order("id")
        .limit(500);
      if (cursor) query = query.gt("id", cursor);
      const { data, error } = await query;
      if (error) throw error;
      if (!data?.length) break;
      formIds.push(...data.map((f) => f.id));
      cursor = data[data.length - 1].id;
      if (data.length < 500) break;
    }

    await removeUploadFiles(admin, { formIds });
    for (const workspaceId of workspaceIds) {
      await removeFolder(admin, THEME_ASSETS_BUCKET, workspaceId);
    }

    const { error: deleteError } = await admin
      .from("workspaces")
      .delete()
      .in("id", workspaceIds);
    if (deleteError) throw deleteError;
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw error;
}
