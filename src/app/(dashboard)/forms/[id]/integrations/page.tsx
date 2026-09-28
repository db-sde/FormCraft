import Link from "next/link";
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

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: formId } = await params;
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
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-2 flex items-center gap-2 text-sm">
        <Link
          href={`/forms/${formId}`}
          className="text-muted-foreground hover:text-foreground"
        >
          {form.title}
        </Link>
        <span className="text-muted-foreground">/</span>
        <span>Integrations</span>
      </div>

      <h1 className="mb-2 text-2xl font-semibold tracking-tight">Webhooks</h1>
      <WebhooksPanel
        formId={formId}
        initialEndpoints={endpoints}
        initialDeliveries={deliveriesByEndpoint}
      />

      <h1 className="mt-10 mb-2 text-2xl font-semibold tracking-tight">Google Sheets</h1>
      <SheetsPanel
        formId={formId}
        configured={isGoogleOAuthConfigured()}
        connection={sheetsConnection}
        initialSyncLog={sheetsSyncLog}
      />
    </div>
  );
}
