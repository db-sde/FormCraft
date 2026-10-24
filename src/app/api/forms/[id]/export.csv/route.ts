import { NextResponse } from "next/server";
import { buildResponsesTable, filtersFromParams } from "@/domains/responses";
import {
  CSV_BOM,
  ExportTooLargeError,
  MAX_SYNCHRONOUS_EXPORT_ROWS,
  toCsv,
  toXlsx,
  XLSX_CONTENT_TYPE,
} from "@/domains/exports";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { trackEvent } from "@/lib/analytics/track";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/domains/audit";
import { hasPermission } from "@/domains/workspaces/permissions";

/**
 * Creator-only, session-scoped (never the admin client) — RLS on
 * `responses`/`answers` already restricts this to the caller's own
 * workspace, and the explicit form/workspace check below gives a
 * clean 404 instead of a silently-empty export for a form that isn't
 * theirs or doesn't exist.
 *
 * `?format=xlsx` returns the same table as an Excel workbook.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: formId } = await params;
  const search = new URL(request.url).searchParams;
  const view = search.get("view") === "incomplete" ? "incomplete" : "completed";
  const excel = search.get("format") === "xlsx";
  // The same filters as the responses page, so the file matches the table.
  const filters = filtersFromParams({
    period: search.get("period"),
    ending: view === "completed" ? search.get("ending") : null,
    q: search.get("q"),
    a: search.get("a"),
    search: search.get("search"),
  });
  const { supabase, workspace } = await getCurrentWorkspace();
  if (!(await hasPermission(supabase, workspace.id, "export_responses"))) {
    return new Response("You don't have permission to export responses.", {
      status: 403,
    });
  }

  const { data: form } = await supabase
    .from("forms")
    .select("id, title")
    .eq("id", formId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!form) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Form not found." } },
      { status: 404 },
    );
  }

  try {
    const { columns, rows } = await buildResponsesTable(supabase, formId, view, filters);
    const base = form.title.replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "form";
    const filename = `${base}-${view === "completed" ? "responses" : "incomplete"}.${excel ? "xlsx" : "csv"}`;

    trackEvent({
      formId,
      eventType: "export_completed",
      metadata: { kind: view, format: excel ? "xlsx" : "csv" },
    });
    void audit(createAdminClient(), {
      workspaceId: workspace.id,
      actorId: (await supabase.auth.getUser()).data.user?.id ?? null,
      action: "export.responses",
      target: { type: "form", id: formId },
      metadata: { view },
    });
    const disposition = `attachment; filename="${filename}"`;
    if (excel) {
      const sheet = view === "completed" ? "Responses" : "Unfinished";
      return new NextResponse(Buffer.from(toXlsx(columns, rows, sheet)), {
        headers: {
          "Content-Type": XLSX_CONTENT_TYPE,
          "Content-Disposition": disposition,
        },
      });
    }
    return new NextResponse(CSV_BOM + toCsv(columns, rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": disposition,
      },
    });
  } catch (error) {
    if (error instanceof ExportTooLargeError) {
      return NextResponse.json(
        {
          error: {
            code: "export_too_large",
            message: `Exports stop at ${MAX_SYNCHRONOUS_EXPORT_ROWS.toLocaleString("en-US")} rows. Add a date filter and export in parts.`,
          },
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: { code: "unknown", message: "Export failed." } },
      { status: 500 },
    );
  }
}
