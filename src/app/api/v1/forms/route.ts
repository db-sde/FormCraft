import { NextResponse, type NextRequest } from "next/server";
import { apiError, withApiKey } from "../shared";

/**
 * The workspace's live forms, for choosing one in Zapier / Make.
 * `?archived=true` lists archived forms instead, `all` both (developer
 * spec item 4); the default is `false`.
 */
export async function GET(request: NextRequest) {
  const archived = request.nextUrl.searchParams.get("archived") ?? "false";
  if (!["true", "false", "all"].includes(archived)) {
    return apiError("invalid_request", "archived must be true, false or all.", 400);
  }
  return withApiKey(request, "forms:read", async (caller, admin) => {
    const forms: { id: string; title: string; archived: boolean }[] = [];
    if (archived !== "true") {
      const { data, error } = await admin
        .from("forms")
        .select("id, title, form_versions!inner(status)")
        .eq("workspace_id", caller.workspaceId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .eq("form_versions.status", "published")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      for (const f of data ?? [])
        forms.push({ id: f.id, title: f.title, archived: false });
    }
    if (archived !== "false") {
      const { data, error } = await admin
        .from("forms")
        .select("id, title")
        .eq("workspace_id", caller.workspaceId)
        .is("deleted_at", null)
        .not("archived_at", "is", null)
        .order("archived_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      for (const f of data ?? [])
        forms.push({ id: f.id, title: f.title, archived: true });
    }
    return NextResponse.json({ forms });
  });
}
