import { NextResponse } from "next/server";
import { buildLeadsCsv } from "@/domains/leads";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";

/** Creator-only, session-scoped (RLS) export of the workspace's leads. */
export async function GET(request: Request) {
  const { supabase, workspace } = await getCurrentWorkspace();
  const formId = new URL(request.url).searchParams.get("form") ?? undefined;

  try {
    const csv = await buildLeadsCsv(supabase, workspace.id, formId);
    return new NextResponse(csv, {
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
