import { NextResponse } from "next/server";
import { CSV_BOM, toCsv, toXlsx, XLSX_CONTENT_TYPE } from "@/domains/exports";
import { buildLeadsTable } from "@/domains/leads";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { trackEvent } from "@/lib/analytics/track";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/domains/audit";
import { hasPermission } from "@/domains/workspaces/permissions";

/** Creator-only, session-scoped (RLS) export of the workspace's leads;
 * `?format=xlsx` for an Excel workbook instead of CSV. */
export async function GET(request: Request) {
  const { supabase, workspace } = await getCurrentWorkspace();
  if (!(await hasPermission(supabase, workspace.id, "export_responses"))) {
    return new Response("You don't have permission to export responses.", {
      status: 403,
    });
  }
  const search = new URL(request.url).searchParams;
  const formId = search.get("form") ?? undefined;
  const excel = search.get("format") === "xlsx";

  try {
    const { columns, rows } = await buildLeadsTable(supabase, workspace.id, formId);
    void audit(createAdminClient(), {
      workspaceId: workspace.id,
      actorId: (await supabase.auth.getUser()).data.user?.id ?? null,
      action: "export.leads",
      metadata: { formId: formId ?? null },
    });
    if (formId) {
      const { data: owned } = await supabase
        .from("forms")
        .select("id")
        .eq("id", formId)
        .eq("workspace_id", workspace.id)
        .maybeSingle();
      if (owned) {
        trackEvent({
          formId,
          eventType: "export_completed",
          metadata: { kind: "leads" },
        });
      }
    }
    if (excel) {
      return new NextResponse(Buffer.from(toXlsx(columns, rows, "Leads")), {
        headers: {
          "Content-Type": XLSX_CONTENT_TYPE,
          "Content-Disposition": 'attachment; filename="leads.xlsx"',
        },
      });
    }
    return new NextResponse(CSV_BOM + toCsv(columns, rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="leads.csv"',
      },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "unknown", message: "Export failed." } },
      { status: 500 },
    );
  }
}
