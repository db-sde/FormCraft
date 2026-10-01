import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { recordAnalyticsEvent } from "@/domains/analytics";
import { hitRateLimit } from "@/domains/abuse";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, getClientIp, readJsonBody } from "../shared";

const EventBody = z.object({
  formId: z.string().uuid(),
  responseId: z.string().uuid().optional(),
  type: z.enum(["question_viewed", "question_answered"]),
  questionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
});

const QUESTION_CACHE_MS = 60_000;
const questionCache = new Map<string, { ids: Set<string> | null; expires: number }>();

/** The live version's question ids for a form (null if it isn't live),
 * cached briefly — step events arrive on every question. */
async function publishedQuestionIds(
  admin: ReturnType<typeof createAdminClient>,
  formId: string,
) {
  const hit = questionCache.get(formId);
  if (hit && hit.expires > Date.now()) return hit.ids;

  const { data } = await admin
    .from("form_versions")
    .select("schema")
    .eq("form_id", formId)
    .eq("status", "published")
    .maybeSingle();
  const questions = (data?.schema as { questions?: { id?: string }[] } | null)?.questions;
  const ids = questions
    ? new Set(
        questions.map((q) => q.id).filter((id): id is string => typeof id === "string"),
      )
    : null;
  if (questionCache.size > 500) questionCache.clear();
  questionCache.set(formId, { ids, expires: Date.now() + QUESTION_CACHE_MS });
  return ids;
}

/**
 * Respondent step events (PRD §3.6: question_viewed / question_answered)
 * — ids only, never answer values. Fire-and-forget from the public
 * runtime; accepted only for a live form, rate-limited per visitor, and
 * recorded after the response is sent so it never slows the respondent.
 */
export async function POST(request: NextRequest) {
  const body = await readJsonBody(request);
  const parsed = EventBody.safeParse(body);
  if (!parsed.success) return apiError("invalid_body", "Invalid request.", 400);

  const admin = createAdminClient();
  const limited = await hitRateLimit(
    admin,
    `events:${getClientIp(request)}:${parsed.data.formId}`,
    300,
    10 * 60 * 1000,
  );
  if (!limited.allowed) return apiError("rate_limited", "Too many events.", 429);

  after(async () => {
    // Only events that make sense for this form are recorded: the form
    // must be live, the question one of its published questions, and a
    // response id (if given) one of this form's responses. Anything else
    // — fabricated ids, another form's response — is quietly dropped, so
    // the funnel can't be skewed by an anonymous caller.
    const questionIds = await publishedQuestionIds(admin, parsed.data.formId);
    if (!questionIds?.has(parsed.data.questionId)) return;
    if (parsed.data.responseId) {
      const { data: owned } = await admin
        .from("responses")
        .select("id")
        .eq("id", parsed.data.responseId)
        .eq("form_id", parsed.data.formId)
        .maybeSingle();
      if (!owned) return;
    }
    try {
      await recordAnalyticsEvent(admin, {
        formId: parsed.data.formId,
        eventType: parsed.data.type,
        sessionId: parsed.data.responseId ?? null,
        metadata: { questionId: parsed.data.questionId },
      });
    } catch {
      // Analytics never affects respondents.
    }
  });
  return new NextResponse(null, { status: 204 });
}
