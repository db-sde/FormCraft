import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { hitRateLimit } from "@/domains/abuse";
import { askFollowUp, replyToFollowUp } from "@/domains/responses/follow-ups";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, getClientIp, readJsonBody } from "../../shared";

/**
 * AI follow-up questions (PRD P3.7). POST asks for one about an answer
 * (`{ question }`, null when there's none — the form never waits on a
 * failure); PUT saves the respondent's reply. The response id is the
 * respondent's bearer secret, as for saving answers; whether a question
 * allows follow-ups is decided from the served version on the server.
 */
const Ask = z.object({
  questionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  answer: z.string().max(50_000),
});
const Reply = z.object({
  questionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  reply: z.string().trim().min(1).max(5000),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = Ask.safeParse(await readJsonBody(request));
  if (!z.string().uuid().safeParse(id).success || !parsed.success)
    return apiError("invalid_body", "Invalid request.", 400);
  const admin = createAdminClient();
  const limit = await hitRateLimit(
    admin,
    `followup:${getClientIp(request)}:${id}`,
    10,
    3_600_000,
  );
  if (!limit.allowed) return NextResponse.json({ question: null });
  try {
    return NextResponse.json({
      question: await askFollowUp(admin, id, parsed.data.questionId, parsed.data.answer),
    });
  } catch {
    // No follow-up is always an acceptable answer.
    return NextResponse.json({ question: null });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = Reply.safeParse(await readJsonBody(request));
  if (!z.string().uuid().safeParse(id).success || !parsed.success)
    return apiError("invalid_body", "Invalid request.", 400);
  const admin = createAdminClient();
  const limit = await hitRateLimit(
    admin,
    `followup-reply:${getClientIp(request)}:${id}`,
    30,
    3_600_000,
  );
  if (!limit.allowed)
    return apiError("rate_limited", "Too many attempts. Please try again shortly.", 429);
  const saved = await replyToFollowUp(
    admin,
    id,
    parsed.data.questionId,
    parsed.data.reply,
  );
  return saved
    ? new NextResponse(null, { status: 204 })
    : apiError("not_found", "There's no follow-up to answer.", 404);
}
