import { notFound } from "next/navigation";
import { listWebhookEndpoints, listDeliveries } from "@/domains/webhooks";
import {
  getConnectionForForm,
  listSyncLog,
  isGoogleOAuthConfigured,
} from "@/domains/sheets";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { WebhooksPanel } from "@/components/integrations/webhooks-panel";
import { SheetsPanel } from "@/components/integrations/sheets-panel";
import { FormTabs } from "@/components/forms/form-tabs";
import { FormPageHeading } from "@/components/forms/form-page-heading";
import { Alert, AlertDescription } from "@/components/ui/alert";

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
  const { supabase, workspace } = await getCurrentWorkspace();

  const { data: form } = await supabase
    .from("forms")
    .select("id, title")
    .eq("id", formId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!form) notFound();

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
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <FormPageHeading title={form.title} />
        <FormTabs formId={formId} active="integrations" />
      </div>

      <div className="mx-auto max-w-2xl">
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

        <h2 className="mb-1 text-xl font-semibold tracking-tight">Webhooks</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          Send every completed response to your own server as a signed JSON request.
        </p>
        <WebhooksPanel
          formId={formId}
          initialEndpoints={endpoints}
          initialDeliveries={deliveriesByEndpoint}
        />

        <h2 className="mt-12 mb-1 text-xl font-semibold tracking-tight">Google Sheets</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          Add a row to a spreadsheet each time someone completes this form.
        </p>
        <SheetsPanel
          formId={formId}
          configured={isGoogleOAuthConfigured()}
          connection={sheetsConnection}
          initialSyncLog={sheetsSyncLog}
        />
      </div>
    </div>
  );
}
