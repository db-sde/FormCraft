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
import { FormAccessPanel } from "@/components/forms/form-access-panel";
import { FormKioskPanel } from "@/components/forms/form-kiosk-panel";
import { getKioskPinHash, readKioskConfig } from "@/domains/forms/kiosk";
import { countAcceptedResponses } from "@/domains/forms/availability";
import { getPasswordHash } from "@/domains/forms/access";
import { isTurnstileConfigured } from "@/domains/abuse/turnstile";
import { createAdminClient } from "@/lib/supabase/admin";

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

  const admin = createAdminClient();
  const [
    versions,
    tests,
    plan,
    canPublish,
    { data: others },
    { data: access },
    accepted,
    passwordHash,
    kioskPinHash,
  ] = await Promise.all([
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
    supabase
      .from("forms")
      .select(
        "closes_at, closed_message, response_cap, full_message, captcha_required, kiosk_config",
      )
      .eq("id", formId)
      .single(),
    // The page already checked this person may edit the form; the hash
    // is only reduced to "has a password".
    countAcceptedResponses(admin, formId),
    getPasswordHash(admin, formId),
    getKioskPinHash(admin, formId),
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
      {access && (
        <FormAccessPanel
          formId={formId}
          initial={{
            closesAt: access.closes_at,
            closedMessage: access.closed_message,
            responseCap: access.response_cap,
            fullMessage: access.full_message,
            captchaRequired: access.captcha_required,
            passwordProtected: passwordHash !== null,
            accepted,
          }}
          captchaAvailable={isTurnstileConfigured()}
          canManage={canPublish}
        />
      )}
      {access && (
        <FormKioskPanel
          formId={formId}
          kioskLink={`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/f/${settings.slug}?kiosk=1`}
          initial={readKioskConfig(access.kiosk_config)}
          hasPin={kioskPinHash !== null}
          canManage={canPublish}
        />
      )}
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
