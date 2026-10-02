import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, withApiKey } from "../../shared";

/** Unsubscribes (the Zap / scenario was turned off). Only subscriptions
 * on the key's own workspace's forms. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    return apiError("not_found", "Not found.", 404);
  return withApiKey(request, async (caller, admin) => {
    const { data: hook } = await admin
      .from("webhook_endpoints")
      .select("id, kind, forms!inner(workspace_id)")
      .eq("id", id)
      .in("kind", ["zapier", "make"])
      .maybeSingle();
    if (
      !hook ||
      (hook.forms as { workspace_id: string }).workspace_id !== caller.workspaceId
    ) {
      return apiError("not_found", "Not found.", 404);
    }
    await admin.from("webhook_endpoints").delete().eq("id", id);
    return new NextResponse(null, { status: 204 });
  });
}
