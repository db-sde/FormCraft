import { NextResponse, type NextRequest } from "next/server";
import { apiError, withApiKey } from "../shared";

/**
 * The workspace's forms, newest first, each saying whether it's live
 * (`published`). `?archived=true` lists archived forms instead, `all`
 * both (developer spec item 4); the default is `false`. Unpublished
 * forms are listed too, so a restored form (which comes back
 * unpublished) never drops out of every list (QA FC15-19).
 */
export async function GET(request: NextRequest) {
  const archived = request.nextUrl.searchParams.get("archived") ?? "false";
  if (!["true", "false", "all"].includes(archived)) {
    return apiError("invalid_request", "archived must be true, false or all.", 400);
  }
  return withApiKey(request, "forms:read", async (caller, admin) => {
    const listed: { id: string; title: string; archived: boolean }[] = [];
    if (archived !== "true") {
      const { data, error } = await admin
        .from("forms")
        .select("id, title")
        .eq("workspace_id", caller.workspaceId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      for (const f of data ?? [])
        listed.push({ id: f.id, title: f.title, archived: false });
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
        listed.push({ id: f.id, title: f.title, archived: true });
    }
    const live = new Set<string>();
    if (listed.length > 0) {
      const { data, error } = await admin
        .from("form_versions")
        .select("form_id")
        .eq("status", "published")
        .in(
          "form_id",
          listed.map((f) => f.id),
        );
      if (error) throw error;
      for (const v of data ?? []) live.add(v.form_id);
    }
    return NextResponse.json({
      forms: listed.map((f) => ({ ...f, published: live.has(f.id) })),
    });
  });
}
