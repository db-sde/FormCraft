import type { Metadata } from "next";
import { cache } from "react";
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
  reviewFormAction,
} from "./actions";
import { aiConfigured } from "@/domains/ai/config";
import { getWorkspacePlan } from "@/domains/billing";

// The title and the page both need the draft: load it once per request.
const loadDraft = cache(async (formId: string) => {
  const { supabase, workspace } = await getCurrentWorkspace();
  return getDraftForEdit(supabase, formId, workspace.id);
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { workspace } = await getCurrentWorkspace();
  // Viewers can't edit; their place is the form's responses.
  if (!canEdit(workspace.role)) redirect(`/forms/${id}/responses`);
  const draft = await loadDraft(id);
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

  const [draft, publishInfo, { entitlements }] = await Promise.all([
    loadDraft(id),
    getPublishInfo(supabase, id),
    getWorkspacePlan(supabase, workspace.id),
  ]);
  if (!draft) notFound();

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
      customFonts={entitlements.custom_fonts}
      multilingual={entitlements.multilingual}
      onProposeRule={proposeRuleAction}
      onReviewForm={reviewFormAction}
    />
  );
}
