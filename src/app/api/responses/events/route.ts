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
    const { data: live } = await admin
      .from("form_versions")
      .select("id")
      .eq("form_id", parsed.data.formId)
      .eq("status", "published")
      .maybeSingle();
    if (!live) return;
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
