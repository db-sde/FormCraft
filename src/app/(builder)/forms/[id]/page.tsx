import { notFound } from "next/navigation";
import { getDraftForEdit, getPublishInfo } from "@/domains/forms";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { FormBuilder } from "@/components/builder/form-builder";
import { saveDraftAction, publishAction, unpublishAction } from "./actions";

export default async function FormBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, workspace } = await getCurrentWorkspace();

  const draft = await getDraftForEdit(supabase, id, workspace.id);
  if (!draft) notFound();

  const publishInfo = await getPublishInfo(supabase, id);

  return (
    <FormBuilder
      formTitle={draft.formTitle}
      workspaceId={workspace.id}
      formId={draft.formId}
      slug={publishInfo?.slug ?? ""}
      appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
      draftVersionId={draft.draftVersionId}
      initialRevision={draft.revision}
      initialSchema={draft.schema}
      initialPublishInfo={{
        isPublished: publishInfo?.isPublished ?? false,
        publishedAt: publishInfo?.publishedAt ?? null,
        publishedVersionNumber: publishInfo?.publishedVersionNumber ?? null,
      }}
      onSave={saveDraftAction}
      onPublish={publishAction}
      onUnpublish={unpublishAction}
    />
  );
}
