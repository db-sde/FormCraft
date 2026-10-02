import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { canEdit } from "@/domains/workspaces";
import { getPublishInfo, publishStateFrom } from "@/domains/forms";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";

/** The form a /forms/[id]/* page is about, scoped to the caller's
 * workspace (404 otherwise) — shared by those pages' headers. Pages
 * that only make sense for people who can edit send viewers to the
 * form's responses (RLS would refuse their changes anyway). */
export async function loadFormForPage(
  formId: string,
  options: { editorsOnly?: boolean } = {},
) {
  const loaded = await loadForm(formId);
  if (options.editorsOnly && loaded.viewOnly) redirect(`/forms/${formId}/responses`);
  return loaded;
}

const loadForm = cache(async (formId: string) => {
  const { supabase, workspace, user } = await getCurrentWorkspace();
  const { data: form } = await supabase
    .from("forms")
    .select("id, title, slug")
    .eq("id", formId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!form) notFound();

  const [publishInfo, { data: versions }] = await Promise.all([
    getPublishInfo(supabase, formId),
    supabase.from("form_versions").select("status").eq("form_id", formId),
  ]);
  return {
    publishState: publishStateFrom((versions ?? []).map((v) => v.status)),
    supabase,
    workspace,
    user,
    form,
    viewOnly: !canEdit(workspace.role),
    isLive: publishInfo?.isPublished ?? false,
    hasUnpublishedChanges: publishInfo?.hasUnpublishedChanges ?? false,
  };
});
