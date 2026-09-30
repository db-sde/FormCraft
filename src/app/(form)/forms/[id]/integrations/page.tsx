import { listWebhookEndpoints, listDeliveries } from "@/domains/webhooks";
import {
  getConnectionForForm,
  listSyncLog,
  isGoogleOAuthConfigured,
} from "@/domains/sheets";
import { WebhooksPanel } from "@/components/integrations/webhooks-panel";
import { SheetsPanel } from "@/components/integrations/sheets-panel";
import { FormTopBar, FormTitle } from "@/components/forms/form-top-bar";
import { FormStatusBadge } from "@/components/forms/form-status-badge";
import { FormPageActions } from "@/components/forms/form-page-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sheet, Webhook } from "lucide-react";
import { loadFormForPage } from "../load-form";

// Outcomes the Google OAuth routes redirect back here with.
const SHEETS_ERRORS: Record<string, string> = {
  not_configured: "Google Sheets isn't set up on this deployment yet.",
  declined: "Google Sheets wasn't connected — access was declined.",
  exchange_failed: "Google Sheets couldn't be connected. Please try again.",
};

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
  const { supabase, form, isLive } = await loadFormForPage(formId);

  const endpoints = await listWebhookEndpoints(supabase, formId);
  const deliveriesByEndpoint = Object.fromEntries(
    await Promise.all(
      endpoints.map(async (e) => [e.id, await listDeliveries(supabase, e.id)] as const),
    ),
  );

  const sheetsConnection = await getConnectionForForm(supabase, formId);
  const sheetsSyncLog = sheetsConnection
    ? await listSyncLog(supabase, sheetsConnection.id)
    : [];

  return (
    <>
      <FormTopBar
        formId={formId}
        active="integrations"
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
          <h2 className="text-2xl font-semibold tracking-tight">Integrations</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Send each completed response somewhere else automatically. Responses are
            always kept here too — a failed delivery never loses one.
          </p>
        </div>
        {sheetsConnected && (
          <Alert className="mb-6">
            <AlertDescription>Google Sheets connected.</AlertDescription>
          </Alert>
        )}
        {sheetsError && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>
              {SHEETS_ERRORS[sheetsError] ?? "Google Sheets couldn't be connected."}
            </AlertDescription>
          </Alert>
        )}

        <section className="mb-10">
          <div className="mb-4 flex items-start gap-3">
            <span className="bg-accent text-accent-foreground grid size-9 shrink-0 place-items-center rounded-lg">
              <Webhook className="size-4" />
            </span>
            <div>
              <h3 className="font-semibold">Webhooks</h3>
              <p className="text-muted-foreground text-sm">
                Post every completed response to your own server as signed JSON — for
                CRMs, Zapier, Make, or your backend.
              </p>
            </div>
          </div>
          <WebhooksPanel
            formId={formId}
            initialEndpoints={endpoints}
            initialDeliveries={deliveriesByEndpoint}
          />
        </section>

        <section>
          <div className="mb-4 flex items-start gap-3">
            <span className="bg-accent text-accent-foreground grid size-9 shrink-0 place-items-center rounded-lg">
              <Sheet className="size-4" />
            </span>
            <div>
              <h3 className="font-semibold">Google Sheets</h3>
              <p className="text-muted-foreground text-sm">
                Add a row to a spreadsheet each time someone completes this form.
              </p>
            </div>
          </div>
          <SheetsPanel
            formId={formId}
            configured={isGoogleOAuthConfigured()}
            connection={sheetsConnection}
            initialSyncLog={sheetsSyncLog}
          />
        </section>
      </main>
    </>
  );
}
