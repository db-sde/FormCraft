import type { Metadata } from "next";
import { Bell, CircleAlert, CircleCheck, Sheet, ShieldX, Webhook } from "lucide-react";
import { listWebhookEndpoints, listDeliveries } from "@/domains/webhooks";
import {
  getConnectionForForm,
  listSyncLog,
  isGoogleOAuthConfigured,
} from "@/domains/sheets";
import { getNotificationsEnabled } from "@/domains/notifications";
import { WebhooksPanel } from "@/components/integrations/webhooks-panel";
import { SheetsPanel } from "@/components/integrations/sheets-panel";
import { NotificationsPanel } from "@/components/integrations/notifications-panel";
import { FormSectionHeader } from "@/components/forms/form-top-bar";
import { FormPageActions } from "@/components/forms/form-page-actions";
import { cn } from "cn";
import {
  ChartLine,
  Contact,
  CreditCard,
  DatabaseZap,
  MailCheck,
  MessageSquare,
} from "lucide-react";
import { PaymentPanel } from "@/components/integrations/payment-panel";
import { HubspotPanel } from "@/components/integrations/hubspot-panel";
import { readPaymentConfig } from "@/domains/payments/stripe";
import { SlackPanel } from "@/components/integrations/slack-panel";
import { ConfirmationPanel } from "@/components/integrations/confirmation-panel";
import { TrackingPanel } from "@/components/integrations/tracking-panel";
import { LookupsPanel } from "@/components/integrations/lookups-panel";
import { listLookups } from "@/domains/integrations/lookups";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWorkspacePlan } from "@/domains/billing";
import { parseFormSchema } from "@/domains/forms/schema";
import {
  emailQuestions,
  getConfirmationSettings,
} from "@/domains/notifications/confirmation";
import { loadFormForPage } from "../../load-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { form } = await loadFormForPage(id);
  return { title: `${form.title} · Integrations` };
}

// Outcomes the Google OAuth routes redirect back here with.
const SHEETS_ERRORS: Record<string, { text: string; tone: "warning" | "error" }> = {
  not_configured: {
    text: "Google Sheets isn't set up on this server yet.",
    tone: "warning",
  },
  declined: {
    text: "Google Sheets wasn't connected because access was declined. You can try again whenever you're ready.",
    tone: "warning",
  },
  exchange_failed: {
    text: "Google Sheets couldn't be connected. Please try again.",
    tone: "error",
  },
};

function Section({
  icon,
  tint,
  title,
  description,
  first = false,
  children,
}: {
  icon: React.ReactNode;
  tint: "choice" | "live" | "text";
  title: string;
  description: React.ReactNode;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-8",
        !first && "border-border border-t-[1.5px] pt-6",
      )}
    >
      <div>
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "border-ink grid size-[34px] shrink-0 place-items-center rounded-[8px] border-[1.5px] [&_svg]:size-[17px]",
              tint === "choice" && "bg-[var(--qt-choice-bg)] text-[var(--qt-choice-fg)]",
              tint === "live" && "bg-[var(--chip-live-bg)] text-[var(--chip-live-fg)]",
              tint === "text" && "bg-[var(--qt-text-bg)] text-[var(--qt-text-fg)]",
            )}
          >
            {icon}
          </span>
          <h2 className="font-heading text-2xl font-bold">{title}</h2>
        </div>
        <div className="text-muted-foreground mt-2.5 text-sm leading-[1.55]">
          {description}
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export default async function IntegrationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sheets_error?: string; sheets_connected?: string }>;
}) {
  const { id: formId } = await params;
  const { sheets_error: sheetsError, sheets_connected: sheetsConnected } =
    await searchParams;
  const { supabase, user, workspace, form, isLive, publishState, hasUnpublishedChanges } =
    await loadFormForPage(formId, { editorsOnly: true });

  const [
    allEndpoints,
    sheetsConnection,
    notificationsEnabled,
    { entitlements },
    confirmation,
    { data: draft },
    { data: tracking },
  ] = await Promise.all([
    listWebhookEndpoints(supabase, formId),
    getConnectionForForm(supabase, formId),
    getNotificationsEnabled(supabase, formId),
    getWorkspacePlan(supabase, workspace.id),
    getConfirmationSettings(supabase, formId),
    supabase
      .from("form_versions")
      .select("schema")
      .eq("form_id", formId)
      .eq("status", "draft")
      .maybeSingle(),
    supabase
      .from("forms")
      .select("ga_measurement_id, gtm_container_id, meta_pixel_id, payment_config")
      .eq("id", formId)
      .single(),
  ]);
  const { data: connections } = await supabase.rpc("integration_status", {
    p_workspace_id: workspace.id,
  });
  const hubspotEndpoint = allEndpoints.find((e) => e.kind === "hubspot");
  const { data: hubspotConfig } = hubspotEndpoint
    ? await supabase
        .from("webhook_endpoints")
        .select("config")
        .eq("id", hubspotEndpoint.id)
        .single()
    : { data: null };
  // Lookups are server-only rows; this page is for editors of the form
  // (loadFormForPage checked), and the list carries no secret.
  const lookups = await listLookups(createAdminClient(), formId);
  const endpoints = allEndpoints.filter((e) => e.kind === "webhook");
  const slackEndpoints = allEndpoints.filter((e) => e.kind === "slack");
  const schema = draft ? parseFormSchema(draft.schema) : null;
  let n = 0;
  const numbered = (schema?.questions ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter((q) => q.type !== "welcome_screen")
    .map((q) => ({ question: q, number: ++n }));
  const deliveriesByEndpoint = Object.fromEntries(
    await Promise.all(
      endpoints.map(async (e) => [e.id, await listDeliveries(supabase, e.id)] as const),
    ),
  );
  const sheetsSyncLog = sheetsConnection
    ? await listSyncLog(supabase, sheetsConnection.id)
    : [];
  const sheetsBanner = sheetsError
    ? (SHEETS_ERRORS[sheetsError] ?? SHEETS_ERRORS.exchange_failed)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <FormSectionHeader
        formId={formId}
        title={form.title}
        active="integrations"
        state={publishState}
        hasChanges={hasUnpublishedChanges}
        actions={<FormPageActions formId={formId} isLive={isLive} />}
      />

      <Section
        first
        icon={<Webhook />}
        tint="choice"
        title="Webhooks"
        description="Send every completed response to your own server as a signed JSON request. A failed delivery never loses a response; it's always kept here too."
      >
        <WebhooksPanel
          formId={formId}
          initialEndpoints={endpoints}
          initialDeliveries={deliveriesByEndpoint}
        />
      </Section>

      <Section
        icon={<Sheet />}
        tint="live"
        title="Google Sheets"
        description="Add a row to a spreadsheet each time someone completes this form."
      >
        <div className="flex flex-col gap-3.5">
          {sheetsConnected && (
            <div
              role="status"
              className="flex gap-2.5 rounded-sm border-[1.5px] border-[var(--alert-success-border)] bg-[var(--alert-success-bg)] px-3 py-[11px] text-[13.5px] text-[var(--alert-success-fg)]"
            >
              <CircleCheck className="mt-px size-[17px] shrink-0" />
              <span>
                <b>Google Sheets connected.</b> Add a spreadsheet ID below to start
                syncing.
              </span>
            </div>
          )}
          {sheetsBanner && (
            <div
              role="alert"
              className={cn(
                "flex gap-2.5 rounded-sm border-[1.5px] px-3 py-[11px] text-[13.5px] leading-[1.45]",
                sheetsBanner.tone === "warning"
                  ? "border-warning bg-[var(--chip-draft-bg)] text-[var(--chip-draft-fg)]"
                  : "border-[var(--alert-error-border)] bg-[var(--alert-error-bg)] text-[var(--alert-error-fg)]",
              )}
            >
              {sheetsBanner.tone === "warning" ? (
                <ShieldX className="mt-px size-[17px] shrink-0" />
              ) : (
                <CircleAlert className="mt-px size-[17px] shrink-0" />
              )}
              <span>{sheetsBanner.text}</span>
            </div>
          )}
          <SheetsPanel
            formId={formId}
            configured={isGoogleOAuthConfigured()}
            connection={sheetsConnection}
            initialSyncLog={sheetsSyncLog}
          />
        </div>
      </Section>

      <Section
        icon={<MessageSquare />}
        tint="choice"
        title="Slack"
        description="Post each completed response to a Slack channel."
      >
        <SlackPanel
          formId={formId}
          endpoints={slackEndpoints}
          allowed={entitlements.slack}
          questions={numbered
            .filter(({ question: q }) => q.type !== "statement")
            .map(({ question: q, number }) => ({
              id: q.id,
              number,
              label: q.label.trim() || "Untitled",
            }))}
        />
      </Section>

      <Section
        icon={<CreditCard />}
        tint="live"
        title="Payment"
        description="Charge respondents when they submit, through your Stripe account."
      >
        <PaymentPanel
          formId={formId}
          initial={readPaymentConfig(tracking?.payment_config ?? null)}
          allowed={entitlements.payments}
          stripeConnected={!!connections?.some((c) => c.provider === "stripe")}
          numberVariables={(schema?.variables ?? [])
            .filter((v) => v.type === "number")
            .map((v) => ({ id: v.id, name: v.name }))}
        />
      </Section>

      <Section
        icon={<Contact />}
        tint="choice"
        title="HubSpot"
        description="Create or update a HubSpot contact for each response."
      >
        <HubspotPanel
          formId={formId}
          allowed={entitlements.crm}
          connected={!!connections?.some((c) => c.provider === "hubspot")}
          initial={
            (hubspotConfig?.config as { mapping?: Record<string, string> } | null)
              ?.mapping ?? null
          }
          sources={numbered.flatMap(({ question: q, number }) => {
            const label = `${number} · ${q.label.trim() || "Untitled"}`;
            if (q.type === "contact_info") {
              return ((q.settings as { fields?: string[] }).fields ?? []).map(
                (field) => ({
                  value: `${q.id}.${field}`,
                  label: `${label} → ${field}`,
                }),
              );
            }
            if (q.type === "statement" || q.type === "file_upload") return [];
            return [{ value: q.id, label }];
          })}
        />
      </Section>

      <Section
        icon={<DatabaseZap />}
        tint="choice"
        title="Data lookups"
        description="Call your own API after a question and use what it returns in the form's logic."
      >
        <LookupsPanel
          formId={formId}
          allowed={entitlements.data_lookups}
          lookups={lookups}
          questions={numbered
            .filter(({ question: q }) => q.type !== "statement")
            .map(({ question: q, number }) => ({
              id: q.id,
              number,
              label: q.label.trim() || "Untitled",
            }))}
          fields={(schema?.hiddenFields ?? []).map((f) => f.name)}
        />
      </Section>

      <Section
        icon={<MailCheck />}
        tint="text"
        title="Confirmation email"
        description="Email respondents a copy or a thank-you after they submit."
      >
        <ConfirmationPanel
          formId={formId}
          initial={confirmation}
          allowed={entitlements.confirmation_emails}
          emailConfigured={Boolean(process.env.RESEND_API_KEY)}
          emailQuestions={(schema ? emailQuestions(schema) : []).map((q) => ({
            id: q.id,
            label: `${numbered.find((x) => x.question.id === q.id)?.number ?? ""} · ${q.label.trim() || "Untitled"}`,
          }))}
        />
      </Section>

      <Section
        icon={<ChartLine />}
        tint="live"
        title="Analytics and ad pixels"
        description="Measure visits to the live form in Google Analytics, Tag Manager or Meta."
      >
        <TrackingPanel
          formId={formId}
          allowed={entitlements.tracking_pixels}
          initial={{
            gaMeasurementId: tracking?.ga_measurement_id ?? "",
            gtmContainerId: tracking?.gtm_container_id ?? "",
            metaPixelId: tracking?.meta_pixel_id ?? "",
          }}
        />
      </Section>

      <Section
        icon={<Bell />}
        tint="text"
        title="Email notifications"
        description="Get an email for each completed response."
      >
        <NotificationsPanel
          formId={formId}
          initialEnabled={notificationsEnabled}
          ownerEmail={user.email ?? ""}
          emailConfigured={Boolean(process.env.RESEND_API_KEY)}
        />
      </Section>
    </div>
  );
}
