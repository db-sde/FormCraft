import { notFound } from "next/navigation";
import { getDraftForEdit, getPublishInfo } from "@/domains/forms";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { FormBuilder } from "@/components/builder/form-builder";
import {
  saveDraftAction,
  publishAction,
  unpublishAction,
  renameFormAction,
} from "./actions";

export default async function FormBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ leadCapture?: string }>;
}) {
  const { id } = await params;
  const { leadCapture } = await searchParams;
  const { supabase, workspace } = await getCurrentWorkspace();

  const draft = await getDraftForEdit(supabase, id, workspace.id);
  if (!draft) notFound();

  const publishInfo = await getPublishInfo(supabase, id);

  return (
    <FormBuilder
      addLeadCaptureOnOpen={leadCapture === "1"}
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
        hasUnpublishedChanges: publishInfo?.hasUnpublishedChanges ?? false,
      }}
      onSave={saveDraftAction}
      onPublish={publishAction}
      onUnpublish={unpublishAction}
      onRename={renameFormAction}
    />
  );
}
