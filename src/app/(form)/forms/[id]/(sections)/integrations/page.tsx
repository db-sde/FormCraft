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
  FileText,
  CreditCard,
  DatabaseZap,
  MailCheck,
  MessageSquare,
} from "lucide-react";
import { PaymentPanel } from "@/components/integrations/payment-panel";
import { HubspotPanel } from "@/components/integrations/hubspot-panel";
import { readPaymentConfig } from "@/domains/payments/config";
import { couponFromRow } from "@/domains/payments/coupons";
import { formCurrencies } from "@/domains/forms/products";
import { SlackPanel } from "@/components/integrations/slack-panel";
import { ConfirmationPanel } from "@/components/integrations/confirmation-panel";
import { TrackingPanel } from "@/components/integrations/tracking-panel";
import { LookupsPanel } from "@/components/integrations/lookups-panel";
import { listLookups } from "@/domains/integrations/lookups";
import { getWorkspacePlan } from "@/domains/billing";
import { parseFormSchema } from "@/domains/forms/schema";
import {
  emailQuestions,
  getConfirmationSettings,
} from "@/domains/notifications/confirmation";
import { loadFormForPage } from "../../load-form";
import { DocumentsPanel } from "@/components/integrations/documents-panel";
import { NotificationRulesPanel } from "@/components/integrations/notification-rules-panel";
import { listNotificationRules } from "@/domains/notifications/rules";
import { listFormDocuments } from "@/domains/documents/issue";
import { assignableMembers } from "@/domains/responses/records";
import { AppsPanel, type AppState } from "@/components/integrations/apps-panel";
import { APPS } from "@/domains/connectors/catalog";
import { listLinks } from "@/domains/connectors/links";
import { sourceOptions } from "@/domains/connectors/mapping";
import { isConfigured } from "@/domains/connectors/oauth";
import { canAdmin } from "@/domains/workspaces";
import { hasPermission } from "@/domains/workspaces/permissions";
import { Blocks } from "lucide-react";
import { NotSetUpYet } from "@/components/not-set-up-yet";
import { notSetUpMessage } from "@/lib/not-set-up";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { form } = await loadFormForPage(id);
  return { title: `${form.title} · Integrations` };
}

// Outcomes the app-connection routes redirect back here with.
const CONNECT_ERRORS: Record<string, string> = {
  not_configured: notSetUpMessage("That app"),
  forbidden: "You need permission to manage integrations to connect apps.",
  declined: "The app wasn't connected because access was declined.",
  workspace: "That connection was started in another workspace. Try again here.",
  exchange_failed: "The app couldn't be connected. Please try again.",
};

// Outcomes the Google OAuth routes redirect back here with.
const SHEETS_ERRORS: Record<string, { text: string; tone: "warning" | "error" }> = {
  not_configured: {
    text: notSetUpMessage("Google Sheets"),
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
  searchParams: Promise<{
    sheets_error?: string;
    sheets_connected?: string;
    connected?: string;
    connect_error?: string;
  }>;
}) {
  const { id: formId } = await params;
  const {
    sheets_error: sheetsError,
    sheets_connected: sheetsConnected,
    connected: appConnected,
    connect_error: connectError,
  } = await searchParams;
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
      .select(
        "ga_measurement_id, gtm_container_id, meta_pixel_id, linkedin_partner_id, linkedin_conversion_id, tiktok_pixel_id, pixel_consent, payment_config, confidential",
      )
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
  // The editor's own access: the header value is never readable
  // (migration 58 grants every other column).
  const lookups = await listLookups(supabase, formId);
  const [documents, members, rules, { data: digest }, { data: coupons }] =
    await Promise.all([
      listFormDocuments(supabase, formId),
      assignableMembers(supabase, workspace.id),
      listNotificationRules(supabase, formId),
      supabase
        .from("notification_digests")
        .select("enabled, member_ids, time_zone, frequency")
        .eq("form_id", formId)
        .maybeSingle(),
      supabase.from("coupons").select("*").eq("form_id", formId).order("created_at"),
    ]);
  // Business apps (Phase 6): only those set up on this server can be
  // connected; the rest are listed as on their way.
  const offeredApps = APPS.filter((a) => isConfigured(a.provider));
  const comingApps = APPS.filter((a) => !isConfigured(a.provider)).map((a) => a.label);
  const [links, mayManageApps, { data: appConnections }] = offeredApps.length
    ? await Promise.all([
        listLinks(supabase, formId),
        canAdmin(workspace.role)
          ? Promise.resolve(true)
          : hasPermission(supabase, workspace.id, "manage_integrations"),
        supabase.rpc("connector_status", { p_workspace_id: workspace.id }),
      ])
    : [[], false, { data: [] }];
  const appStates: AppState[] = offeredApps.map((app) => {
    const connection = appConnections?.find(
      (c) => c.provider === app.provider && c.user_id === null && c.status !== "revoked",
    );
    const link = links.find((l) => l.provider === app.provider);
    return {
      provider: app.provider,
      connection: connection
        ? {
            label: connection.label,
            status: connection.status === "ok" ? "ok" : "invalid",
          }
        : null,
      link: link
        ? {
            enabled: link.enabled,
            settings: link.settings,
            mapping: link.mapping,
            condition: link.condition,
          }
        : null,
    };
  });
  const endpoints = allEndpoints.filter((e) => e.kind === "webhook");
  const slackEndpoints = allEndpoints.filter((e) => e.kind === "slack");
  const schema = draft ? parseFormSchema(draft.schema) : null;
  let n = 0;
  const numbered = (schema?.questions ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter((q) => q.type !== "welcome_screen" && q.type !== "page_break")
    .map((q) => ({ question: q, number: ++n }));
  const deliveriesByEndpoint = Object.fromEntries(
    await Promise.all(
      endpoints.map(async (e) => [e.id, await listDeliveries(supabase, e.id)] as const),
    ),
  );
  const sheetsSyncLog = sheetsConnection
    ? await listSyncLog(supabase, sheetsConnection.id)
    : [];
  // Features that need server setup show a friendly "almost here" note
  // instead of settings until it's done.
  const sheetsAvailable = isGoogleOAuthConfigured();
  const emailAvailable = Boolean(process.env.RESEND_API_KEY);
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
      {tracking?.confidential ? (
        <p className="rounded-sm bg-[var(--alert-warning-bg)] px-3 py-2.5 text-sm text-[var(--alert-warning-fg)]">
          This form&apos;s responses are confidential, so webhooks (and Slack, HubSpot and
          Zapier), Google Sheets, apps, PDF documents and notification rules don&apos;t
          run for it. Your new-response alert and respondents&apos; own confirmations
          still do.
        </p>
      ) : null}

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
        {!sheetsAvailable ? (
          <NotSetUpYet feature="Google Sheets">
            Meanwhile, you can download every response as a CSV from Responses.
          </NotSetUpYet>
        ) : (
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
              configured={sheetsAvailable}
              connection={sheetsConnection}
              initialSyncLog={sheetsSyncLog}
            />
          </div>
        )}
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
        description="Charge respondents when they submit, with your Razorpay (INR: cards, UPI…) or Stripe account — a fixed price, a calculated total or their order, with coupons."
      >
        <PaymentPanel
          formId={formId}
          initial={readPaymentConfig(tracking?.payment_config ?? null)}
          allowed={entitlements.payments}
          stripeConnected={!!connections?.some((c) => c.provider === "stripe")}
          razorpayConnected={!!connections?.some((c) => c.provider === "razorpay")}
          orderCurrency={schema ? (formCurrencies(schema.questions)[0] ?? null) : null}
          coupons={(coupons ?? []).map(couponFromRow)}
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
            if (q.type === "address") {
              return ((q.settings as { fields?: string[] }).fields ?? []).map(
                (field) => ({
                  value: `${q.id}.${field}`,
                  label: `${label} → ${field}`,
                }),
              );
            }
            if (
              q.type === "statement" ||
              q.type === "file_upload" ||
              q.type === "signature" ||
              q.type === "matrix"
            )
              return [];
            return [{ value: q.id, label }];
          })}
        />
      </Section>

      <Section
        icon={<Blocks />}
        tint="live"
        title="Apps"
        description="Send each completed response to Airtable, Notion, Mailchimp or your CRM. Connect an app once for the workspace, then choose here where this form's responses go. A failed sync never loses a response; it's on the response's timeline, where you can send it again."
      >
        {appStates.length === 0 ? (
          <NotSetUpYet feature="Apps" plural>
            {new Intl.ListFormat("en").format(comingApps)}{" "}
            {comingApps.length === 1 ? "is" : "are"} on their way.
          </NotSetUpYet>
        ) : (
          <div className="flex flex-col gap-3.5">
            {appConnected && appStates.some((a) => a.provider === appConnected) && (
              <div
                role="status"
                className="flex gap-2.5 rounded-sm border-[1.5px] border-[var(--alert-success-border)] bg-[var(--alert-success-bg)] px-3 py-[11px] text-[13.5px] text-[var(--alert-success-fg)]"
              >
                <CircleCheck className="mt-px size-[17px] shrink-0" />
                <span>
                  <b>Connected.</b> Choose where this form&apos;s responses go below.
                </span>
              </div>
            )}
            {connectError && (
              <div
                role="alert"
                className="flex gap-2.5 rounded-sm border-[1.5px] border-[var(--alert-error-border)] bg-[var(--alert-error-bg)] px-3 py-[11px] text-[13.5px] text-[var(--alert-error-fg)]"
              >
                <CircleAlert className="mt-px size-[17px] shrink-0" />
                <span>
                  {CONNECT_ERRORS[connectError] ?? CONNECT_ERRORS.exchange_failed}
                </span>
              </div>
            )}
            <AppsPanel
              formId={formId}
              apps={appStates}
              canManage={mayManageApps}
              schema={schema}
              sources={schema ? sourceOptions(schema) : []}
              questions={numbered.map(({ question: q, number }) => ({
                id: q.id,
                type: q.type,
                label: `${number} · ${q.label.trim() || "Untitled"}`,
              }))}
            />
            {comingApps.length > 0 && (
              <p className="text-muted-foreground text-[13px]">
                On their way: {new Intl.ListFormat("en").format(comingApps)}.
              </p>
            )}
          </div>
        )}
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
        {!emailAvailable ? (
          <NotSetUpYet feature="Confirmation email">
            Respondents still see your thank-you screen as soon as they submit.
          </NotSetUpYet>
        ) : (
          <ConfirmationPanel
            formId={formId}
            initial={confirmation}
            allowed={entitlements.confirmation_emails}
            emailConfigured={emailAvailable}
            emailQuestions={(schema ? emailQuestions(schema) : []).map((q) => ({
              id: q.id,
              label: `${numbered.find((x) => x.question.id === q.id)?.number ?? ""} · ${q.label.trim() || "Untitled"}`,
            }))}
          />
        )}
      </Section>

      <Section
        icon={<FileText />}
        tint="choice"
        title="PDF documents"
        description="A response summary, order confirmation, registration confirmation or certificate, numbered per form. Download any of them from a response, or email them on submit."
      >
        <DocumentsPanel
          formId={formId}
          workspaceId={workspace.id}
          emailConfigured={emailAvailable}
          initial={documents.map((d) => ({
            kind: d.kind,
            enabled: d.enabled,
            settings: d.settings,
            recipients: d.recipients,
            memberIds: d.memberIds,
          }))}
          emailQuestions={(schema ? emailQuestions(schema) : []).map((q) => ({
            id: q.id,
            label: `${numbered.find((x) => x.question.id === q.id)?.number ?? ""} · ${q.label.trim() || "Untitled"}`,
          }))}
          nameQuestions={numbered
            .filter(
              ({ question: q }) =>
                q.type === "short_text" ||
                (q.type === "contact_info" && q.settings.fields.includes("name")),
            )
            .map(({ question: q, number }) => ({
              id: q.id,
              label: `${number} · ${q.label.trim() || "Untitled"}`,
            }))}
          endings={(schema?.endings ?? []).map((e) => ({
            id: e.id,
            label: e.title.trim() || "Untitled ending",
          }))}
          variables={(schema?.variables ?? [])
            .filter((v) => v.type === "number")
            .map((v) => ({ id: v.id, label: v.name }))}
          members={members.map((m) => ({ id: m.id, label: m.name }))}
        />
      </Section>

      <Section
        icon={<ChartLine />}
        tint="live"
        title="Analytics and ad pixels"
        description="Measure visits, starts and submissions in Google Analytics, Tag Manager, Meta, LinkedIn or TikTok."
      >
        <TrackingPanel
          formId={formId}
          allowed={entitlements.tracking_pixels}
          initial={{
            gaMeasurementId: tracking?.ga_measurement_id ?? "",
            gtmContainerId: tracking?.gtm_container_id ?? "",
            metaPixelId: tracking?.meta_pixel_id ?? "",
            linkedinPartnerId: tracking?.linkedin_partner_id ?? "",
            linkedinConversionId: tracking?.linkedin_conversion_id ?? "",
            tiktokPixelId: tracking?.tiktok_pixel_id ?? "",
            consent: tracking?.pixel_consent === "ask" ? "ask" : "none",
          }}
        />
      </Section>

      <Section
        icon={<Bell />}
        tint="text"
        title="Email notifications"
        description="An email to you for each response, rules that email teammates when answers match, and a daily digest."
      >
        {!emailAvailable ? (
          <NotSetUpYet feature="Email notifications" plural>
            Every response is still saved and waiting for you in Responses.
          </NotSetUpYet>
        ) : (
          <div className="flex flex-col gap-4">
            <NotificationsPanel
              formId={formId}
              initialEnabled={notificationsEnabled}
              ownerEmail={user.email ?? ""}
              emailConfigured={emailAvailable}
            />
            <NotificationRulesPanel
              formId={formId}
              schema={schema}
              members={members.map((m) => ({ id: m.id, label: m.name }))}
              documents={documents
                .filter((d) => d.enabled && d.kind !== "receipt")
                .map((d) => d.kind as Exclude<typeof d.kind, "receipt">)}
              initialRules={rules}
              initialDigest={
                digest
                  ? {
                      enabled: digest.enabled,
                      memberIds: digest.member_ids,
                      timeZone: digest.time_zone,
                      frequency: digest.frequency === "weekly" ? "weekly" : "daily",
                    }
                  : null
              }
            />
          </div>
        )}
      </Section>
    </div>
  );
}
