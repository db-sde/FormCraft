import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * Folders (PRD P2.20). Every call runs as the signed-in user: RLS lets
 * members read and editors change (migration 28), and a trigger keeps a
 * form out of another workspace's folder. Deleting a folder moves its
 * forms back to "no folder" (on delete set null) — never deletes them.
 */

export type Folder = { id: string; name: string };

export class FolderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FolderError";
  }
}

function cleanName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > 80)
    throw new FolderError("Name it in 1 to 80 characters.");
  return trimmed;
}

export async function listFolders(
  supabase: Client,
  workspaceId: string,
): Promise<Folder[]> {
  const { data, error } = await supabase
    .from("folders")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createFolder(
  supabase: Client,
  workspaceId: string,
  name: string,
): Promise<Folder> {
  const { data, error } = await supabase
    .from("folders")
    .insert({ workspace_id: workspaceId, name: cleanName(name) })
    .select("id, name")
    .single();
  if (error) throw new FolderError("Couldn't create the folder.");
  return data;
}

export async function renameFolder(
  supabase: Client,
  workspaceId: string,
  folderId: string,
  name: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("folders")
    .update({ name: cleanName(name) })
    .eq("id", folderId)
    .eq("workspace_id", workspaceId)
    .select("id");
  if (error || !data?.length) throw new FolderError("Couldn't rename the folder.");
}

/** Deletes a folder; its forms stay, outside any folder. */
export async function deleteFolder(
  supabase: Client,
  workspaceId: string,
  folderId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("folders")
    .delete()
    .eq("id", folderId)
    .eq("workspace_id", workspaceId)
    .select("id");
  if (error || !data?.length) throw new FolderError("Couldn't delete the folder.");
}

export async function moveFormToFolder(
  supabase: Client,
  workspaceId: string,
  formId: string,
  folderId: string | null,
): Promise<void> {
  const { data, error } = await supabase
    .from("forms")
    .update({ folder_id: folderId })
    .eq("id", formId)
    .eq("workspace_id", workspaceId)
    .select("id");
  if (error || !data?.length) throw new FolderError("Couldn't move the form.");
}
