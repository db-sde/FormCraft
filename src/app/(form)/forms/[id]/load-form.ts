import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getPublishInfo, publishStateFrom } from "@/domains/forms";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";

/** The form a /forms/[id]/* page is about, scoped to the caller's
 * workspace (404 otherwise) — shared by those pages' headers. */
export const loadFormForPage = cache(async (formId: string) => {
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
    isLive: publishInfo?.isPublished ?? false,
    hasUnpublishedChanges: publishInfo?.hasUnpublishedChanges ?? false,
  };
});
