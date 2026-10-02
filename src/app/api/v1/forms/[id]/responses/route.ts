import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { buildWebhookPayload } from "@/domains/webhooks";
import { apiError, withApiKey } from "../../../shared";

/**
 * Completed (non-spam) responses, newest first, in the same shape a
 * webhook delivery has. Cursor pagination: `?limit=1..100` (default 25)
 * and `?cursor=` from the previous page's `next_cursor` (null at the
 * end). Zapier's sample uses `?limit=3`.
 */
const Query = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});

function decodeCursor(cursor: string | undefined): { at: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    return z.string().datetime({ offset: true }).safeParse(at).success &&
      z.string().uuid().safeParse(id).success
      ? { at, id }
      : null;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    return apiError("not_found", "Form not found.", 404);
  const query = Query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return apiError("invalid_query", "limit must be 1–100.", 400);
  const cursor = decodeCursor(query.data.cursor);
  if (query.data.cursor && !cursor)
    return apiError("invalid_query", "That cursor isn't valid.", 400);

  return withApiKey(request, "responses:read", async (caller, admin) => {
    const { data: form } = await admin
      .from("forms")
      .select("id")
      .eq("id", id)
      .eq("workspace_id", caller.workspaceId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!form) return apiError("not_found", "Form not found.", 404);
    let q = admin
      .from("responses")
      .select("id, completed_at, ending_id, answers(question_id, value)")
      .eq("form_id", id)
      .eq("status", "completed")
      .eq("spam_suspected", false)
      .order("completed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(query.data.limit + 1);
    if (cursor) {
      q = q.or(
        `completed_at.lt."${cursor.at}",and(completed_at.eq."${cursor.at}",id.lt.${cursor.id})`,
      );
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    const page = (rows ?? []).slice(0, query.data.limit);
    const last = page.at(-1);
    return NextResponse.json({
      data: page.map((r) =>
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
      next_cursor:
        (rows?.length ?? 0) > query.data.limit && last?.completed_at
          ? Buffer.from(`${last.completed_at}|${last.id}`).toString("base64url")
          : null,
    });
  });
}
