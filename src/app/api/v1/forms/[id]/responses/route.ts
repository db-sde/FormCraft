import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { buildWebhookPayload } from "@/domains/webhooks";
import { apiError, withApiKey } from "../../../shared";

/**
 * The latest completed responses in exactly the shape a subscription
 * receives — Zapier's "perform list" sample, so a Zap can be mapped
 * before the first real response arrives. Spam-flagged ones are left out.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    return apiError("not_found", "Form not found.", 404);
  return withApiKey(request, async (caller, admin) => {
    const { data: form } = await admin
      .from("forms")
      .select("id")
      .eq("id", id)
      .eq("workspace_id", caller.workspaceId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!form) return apiError("not_found", "Form not found.", 404);
    const { data: responses, error } = await admin
      .from("responses")
      .select("id, completed_at, ending_id, answers(question_id, value)")
      .eq("form_id", id)
      .eq("status", "completed")
      .eq("spam_suspected", false)
      .order("completed_at", { ascending: false })
      .limit(3);
    if (error) throw error;
    return NextResponse.json(
      (responses ?? []).map((r) =>
        buildWebhookPayload({
          eventId: r.id,
          formId: id,
          responseId: r.id,
          submittedAt: r.completed_at ?? "",
          endingId: r.ending_id,
          answers: Object.fromEntries(
            (r.answers ?? []).map((a) => [a.question_id, a.value]),
          ),
        }),
      ),
    );
  });
}
