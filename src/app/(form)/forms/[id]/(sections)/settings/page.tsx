import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormSettings } from "@/domains/forms";
import { FormSectionHeader } from "@/components/forms/form-top-bar";
import { FormPageActions } from "@/components/forms/form-page-actions";
import { FormSettingsPanel } from "@/components/forms/form-settings-panel";
import { VersionHistory } from "@/components/forms/version-history";
import { listVersions } from "@/domains/forms/versions/history";
import { AbTestPanel } from "@/components/forms/ab-test-panel";
import { listExperiments } from "@/domains/experiments";
import { getWorkspacePlan } from "@/domains/billing/entitlements";
import { hasPermission } from "@/domains/workspaces/permissions";
import { loadFormForPage } from "../../load-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { form } = await loadFormForPage(id);
  return { title: `${form.title} · Settings` };
}

export default async function FormSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: formId } = await params;
  const { supabase, workspace, form, isLive, publishState, hasUnpublishedChanges } =
    await loadFormForPage(formId, { editorsOnly: true });
  const settings = await getFormSettings(supabase, formId, workspace.id);
  if (!settings) notFound();

  const [versions, tests, plan, canPublish, { data: others }] = await Promise.all([
    listVersions(supabase, formId),
    listExperiments(supabase, formId),
    getWorkspacePlan(supabase, workspace.id),
    hasPermission(supabase, workspace.id, "publish"),
    supabase
      .from("forms")
      .select("id, title, form_versions!inner(status)")
      .eq("workspace_id", workspace.id)
      .eq("form_versions.status", "published")
      .neq("id", formId)
      .is("deleted_at", null)
      .order("title")
      .limit(200),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <FormSectionHeader
        formId={formId}
        title={form.title}
        active="settings"
        state={publishState}
        hasChanges={hasUnpublishedChanges}
        actions={<FormPageActions formId={formId} isLive={isLive} />}
      />
      <FormSettingsPanel
        formId={formId}
        appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
        initial={settings}
      />
      <AbTestPanel
        formId={formId}
        formTitle={form.title}
        tests={tests}
        candidates={(others ?? []).map((f) => ({ id: f.id, title: f.title }))}
        allowed={plan.entitlements.ab_testing}
        canManage={canPublish}
      />
      <VersionHistory formId={formId} versions={versions} />
    </div>
  );
}
