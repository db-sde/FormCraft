import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { canEdit } from "@/domains/workspaces";
import { getDraftForEdit, getPublishInfo } from "@/domains/forms";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { FormBuilder } from "@/components/builder/form-builder";
import {
  saveDraftAction,
  publishAction,
  unpublishAction,
  renameFormAction,
  proposeRuleAction,
} from "./actions";
import { aiConfigured } from "@/domains/ai/config";
import { getWorkspacePlan } from "@/domains/billing";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { supabase, workspace } = await getCurrentWorkspace();
  // Viewers can't edit; their place is the form's responses.
  if (!canEdit(workspace.role)) redirect(`/forms/${id}/responses`);
  const draft = await getDraftForEdit(supabase, id, workspace.id);
  return { title: draft ? `${draft.formTitle} · Build` : "Build" };
}

export default async function FormBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ leadCapture?: string; preview?: string }>;
}) {
  const { id } = await params;
  const { leadCapture, preview } = await searchParams;
  const { supabase, workspace } = await getCurrentWorkspace();

  const draft = await getDraftForEdit(supabase, id, workspace.id);
  if (!draft) notFound();

  const [publishInfo, { entitlements }] = await Promise.all([
    getPublishInfo(supabase, id),
    getWorkspacePlan(supabase, workspace.id),
  ]);

  return (
    <FormBuilder
      addLeadCaptureOnOpen={leadCapture === "1"}
      openPreviewOnLoad={preview === "1"}
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
      aiEnabled={aiConfigured()}
      brandingRemovable={entitlements.remove_branding}
      onProposeRule={proposeRuleAction}
    />
  );
}
