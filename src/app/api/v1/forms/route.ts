import { NextResponse, type NextRequest } from "next/server";
import { withApiKey } from "../shared";

/** The workspace's live forms, for choosing one in Zapier / Make. */
export async function GET(request: NextRequest) {
  return withApiKey(request, "forms:read", async (caller, admin) => {
    const { data, error } = await admin
      .from("forms")
      .select("id, title, form_versions!inner(status)")
      .eq("workspace_id", caller.workspaceId)
      .is("deleted_at", null)
      .eq("form_versions.status", "published")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return NextResponse.json({
      forms: (data ?? []).map((f) => ({ id: f.id, title: f.title })),
    });
  });
}
