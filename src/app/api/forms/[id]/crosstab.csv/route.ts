import { recordAudit } from "@/domains/audit/record";
import { NextResponse } from "next/server";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { hasPermission } from "@/domains/workspaces/permissions";
import { filtersFromParams } from "@/domains/responses";
import { getLatestSchema } from "@/domains/responses/dashboard";
import { crossTabRows, getCrossTab } from "@/domains/responses/crosstab";
import { CSV_BOM, neutralizeFormulaInjection } from "@/domains/exports";

const cell = (value: string) => {
  const safe = neutralizeFormulaInjection(value);
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/**
 * A cross-tab as CSV (F-30): exactly the table the Responses page shows
 * for the same questions and filters. Same permission as exporting
 * responses; read as the caller (RLS).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: formId } = await params;
  const search = new URL(request.url).searchParams;
  const { supabase, workspace, user } = await getCurrentWorkspace();
  if (!(await hasPermission(supabase, workspace.id, "export_responses"))) {
    return new Response("You don't have permission to export responses.", {
      status: 403,
    });
  }
  const { data: form } = await supabase
    .from("forms")
    .select("id, title, confidential")
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
  if (form.confidential) {
    return new Response(
      "This form's responses are confidential; use its feedback report.",
      {
        status: 403,
      },
    );
  }
  const schema = await getLatestSchema(supabase, formId);
  const filters = filtersFromParams({
    period: search.get("period"),
    ending: search.get("ending"),
    q: search.get("q"),
    a: search.get("a"),
    search: search.get("search"),
    source: search.get("source"),
  });
  const rowId = search.get("x") ?? "";
  const columnId = search.get("y") ?? "";
  const table = schema
    ? await getCrossTab(supabase, formId, schema, rowId, columnId, filters)
    : null;
  if (!schema || !table) {
    return NextResponse.json(
      { error: { code: "invalid", message: "Choose two choice or scale questions." } },
      { status: 400 },
    );
  }
  const label = (id: string) =>
    schema.questions.find((q) => q.id === id)?.label.trim() || id;
  const csv = crossTabRows(table, label(rowId), label(columnId))
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
  void recordAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "export.responses",
    target: { type: "form", id: formId },
    metadata: { view: "crosstab" },
  });
  const base = form.title.replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "form";
  return new Response(CSV_BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${base}-crosstab.csv"`,
    },
  });
}
