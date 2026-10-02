import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { buildWebhookPayload } from "@/domains/webhooks";
import { apiError, withApiKey } from "../../shared";

/** One completed response, in the delivery shape. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    return apiError("not_found", "Response not found.", 404);
  return withApiKey(request, "responses:read", async (caller, admin) => {
    const { data: r } = await admin
      .from("responses")
      .select(
        "id, form_id, completed_at, ending_id, status, answers(question_id, value), forms!inner(workspace_id)",
      )
      .eq("id", id)
      .maybeSingle();
    if (
      !r ||
      r.status !== "completed" ||
      (r.forms as { workspace_id: string }).workspace_id !== caller.workspaceId
    ) {
      return apiError("not_found", "Response not found.", 404);
    }
    return NextResponse.json(
      buildWebhookPayload({
        eventId: r.id,
        formId: r.form_id,
        responseId: r.id,
        submittedAt: r.completed_at ?? "",
        endingId: r.ending_id,
        answers: Object.fromEntries(
          (r.answers ?? []).map((a) => [a.question_id, a.value]),
        ),
      }),
    );
  });
}
