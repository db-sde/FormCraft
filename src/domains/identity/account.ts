import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

const UPLOADS_BUCKET = "response-uploads";

/**
 * Permanently deletes a user and everything they own (PRD P1.1 account
 * deletion, §13): their workspaces — which cascade to forms, versions,
 * responses, answers, integrations and analytics — the files
 * respondents uploaded to those forms (storage isn't covered by the
 * database cascade), then the auth user (cascading their profile and
 * memberships). Service-role client only.
 */
export async function deleteAccount(admin: Client, userId: string): Promise<void> {
  const { data: workspaces, error: workspacesError } = await admin
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId);
  if (workspacesError) throw workspacesError;
  const workspaceIds = (workspaces ?? []).map((w) => w.id);

  if (workspaceIds.length > 0) {
    const { data: forms, error: formsError } = await admin
      .from("forms")
      .select("id")
      .in("workspace_id", workspaceIds);
    if (formsError) throw formsError;
    const formIds = (forms ?? []).map((f) => f.id);

    for (let i = 0; i < formIds.length; i += 100) {
      const { data: uploads, error: uploadsError } = await admin
        .from("uploads")
        .select("storage_path, responses!inner(form_id)")
        .in("responses.form_id", formIds.slice(i, i + 100))
        .limit(1000);
      if (uploadsError) throw uploadsError;
      if (uploads?.length) {
        const { error } = await admin.storage
          .from(UPLOADS_BUCKET)
          .remove(uploads.map((u) => u.storage_path));
        if (error) throw error;
      }
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
