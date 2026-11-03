"use server";

import { revalidatePath } from "next/cache";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { canEdit } from "@/domains/workspaces";
import { parseEmbedOrigins } from "@/domains/forms/embed-origins";

type Result = { ok: true; origins: string[] | null } | { ok: false; message: string };

/** Which sites may embed this form (hardening, 2026-11-03). Null: any. */
export async function saveEmbedOriginsAction(
  formId: string,
  input: string | null,
): Promise<Result> {
  const parsed =
    input === null ? { ok: true as const, origins: null } : parseEmbedOrigins(input);
  if (!parsed.ok) return parsed;
  const { supabase, workspace } = await getCurrentWorkspace();
  if (!canEdit(workspace.role))
    return { ok: false, message: "You have view-only access." };
  const { data, error } = await supabase
    .from("forms")
    .update({ embed_origins: parsed.origins })
    .eq("id", formId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .select("id");
  if (error || !data?.length)
    return { ok: false, message: "Couldn't save. Please try again." };
  revalidatePath(`/forms/${formId}/share`);
  return { ok: true, origins: parsed.origins };
}
