import { NextResponse, type NextRequest } from "next/server";
import { SWITCHED_OFF, featureEnabled } from "@/domains/flags";
import { z } from "zod";
import { audit } from "@/domains/audit/log";
import { apiError, withApiKey } from "../shared";

/** POST /api/v1/forms/{id}/archive and /restore (developer spec item 4).
 * Needs the forms:write permission; one audit entry per form. */
export async function archiveViaApi(
  request: NextRequest,
  id: string,
  archived: boolean,
): Promise<Response> {
  if (!z.string().uuid().safeParse(id).success)
    return apiError("not_found", "Form not found.", 404);
  let keepBookings = false;
  if (archived) {
    const body = (await request.json().catch(() => ({}))) as { keep_bookings?: unknown };
    keepBookings = body?.keep_bookings === true;
  }
  return withApiKey(request, "forms:write", async (caller, admin) => {
    const { data: form } = await admin
      .from("forms")
      .select("id")
      .eq("id", id)
      .eq("workspace_id", caller.workspaceId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!form) return apiError("not_found", "Form not found.", 404);
    if (archived && !(await featureEnabled("form_archiving", caller.workspaceId, admin)))
      return apiError("switched_off", SWITCHED_OFF, 503);
    const { data, error } = archived
      ? await admin.rpc("archive_form", { p_form_id: id, p_keep_bookings: keepBookings })
      : await admin.rpc("restore_form", { p_form_id: id });
    if (error) throw error;
    const result = data as {
      ok: boolean;
      code?: string;
      count?: number;
      cancelled?: number;
    };
    if (!result.ok) {
      if (result.code === "upcoming_bookings") {
        return NextResponse.json(
          {
            error: {
              code: "upcoming_bookings",
              message: `This form has ${result.count} upcoming booking(s). Cancel them, or send {"keep_bookings": true} to archive and keep them.`,
            },
          },
          { status: 409 },
        );
      }
      return apiError("not_found", "Form not found.", 404);
    }
    await audit(admin, {
      workspaceId: caller.workspaceId,
      actorId: null,
      action: archived ? "form.archived" : "form.restored",
      target: { type: "form", id },
      metadata: { via: "api", keyId: caller.keyId },
    });
    return NextResponse.json({ id, archived });
  });
}
