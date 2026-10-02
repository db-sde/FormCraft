import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, withApiKey } from "../../shared";

/** A form and its live schema (question ids, labels, options) — what
 * an integration needs to label the answers it receives. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    return apiError("not_found", "Form not found.", 404);
  return withApiKey(request, "forms:read", async (caller, admin) => {
    const { data: form } = await admin
      .from("forms")
      .select("id, title, slug, created_at, updated_at")
      .eq("id", id)
      .eq("workspace_id", caller.workspaceId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!form) return apiError("not_found", "Form not found.", 404);
    const { data: version } = await admin
      .from("form_versions")
      .select("version_number, published_at, schema")
      .eq("form_id", id)
      .eq("status", "published")
      .maybeSingle();
    return NextResponse.json({
      ...form,
      published: version
        ? {
            version: version.version_number,
            published_at: version.published_at,
            schema: version.schema,
          }
        : null,
    });
  });
}
