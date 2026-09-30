import { notFound } from "next/navigation";
import { getFormSettings } from "@/domains/forms";
import { getNotificationsEnabled } from "@/domains/notifications";
import { FormTopBar, FormTitle } from "@/components/forms/form-top-bar";
import { FormStatusBadge } from "@/components/forms/form-status-badge";
import { FormPageActions } from "@/components/forms/form-page-actions";
import { FormSettingsPanel } from "@/components/forms/form-settings-panel";
import { loadFormForPage } from "../load-form";

export default async function FormSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: formId } = await params;
  const { supabase, workspace, user, form, isLive } = await loadFormForPage(formId);
  const [settings, notificationsEnabled] = await Promise.all([
    getFormSettings(supabase, formId, workspace.id),
    getNotificationsEnabled(supabase, formId),
  ]);
  if (!settings) notFound();

  return (
    <>
      <FormTopBar
        formId={formId}
        active="settings"
        title={
          <>
            <FormTitle>{form.title}</FormTitle>
            <FormStatusBadge live={isLive} />
          </>
        }
        actions={<FormPageActions formId={formId} slug={form.slug} isLive={isLive} />}
      />
      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Form settings</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            How this form stores answers, who hears about new responses, and its public
            link.
          </p>
        </div>
        <FormSettingsPanel
          formId={formId}
          appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
          initial={{ ...settings, notificationsEnabled }}
          ownerEmail={user.email ?? ""}
          emailConfigured={Boolean(process.env.RESEND_API_KEY)}
        />
      </main>
    </>
  );
}
