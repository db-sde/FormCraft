import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormSettings } from "@/domains/forms";
import { FormSectionHeader } from "@/components/forms/form-top-bar";
import { FormPageActions } from "@/components/forms/form-page-actions";
import { FormSettingsPanel } from "@/components/forms/form-settings-panel";
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
    await loadFormForPage(formId);
  const settings = await getFormSettings(supabase, formId, workspace.id);
  if (!settings) notFound();

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
    </div>
  );
}
