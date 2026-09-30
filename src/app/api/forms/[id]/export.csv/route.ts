import { NextResponse } from "next/server";
import { buildResponsesCsv } from "@/domains/responses";
import { ExportTooLargeError, MAX_SYNCHRONOUS_EXPORT_ROWS } from "@/domains/exports";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";

/**
 * Creator-only, session-scoped (never the admin client) — RLS on
 * `responses`/`answers` already restricts this to the caller's own
 * workspace, and the explicit form/workspace check below gives a
 * clean 404 instead of a silently-empty export for a form that isn't
 * theirs or doesn't exist.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: formId } = await params;
  const view =
    new URL(request.url).searchParams.get("view") === "incomplete"
      ? "incomplete"
      : "completed";
  const { supabase, workspace } = await getCurrentWorkspace();

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
    const csv = await buildResponsesCsv(supabase, formId, view);
    const base = form.title.replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "form";
    const filename = `${base}-${view === "completed" ? "responses" : "incomplete"}.csv`;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ExportTooLargeError) {
      return NextResponse.json(
        {
          error: {
            code: "export_too_large",
            message: `This form has more than ${MAX_SYNCHRONOUS_EXPORT_ROWS} responses, which exceeds the export limit. Contact support for a bulk export.`,
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
