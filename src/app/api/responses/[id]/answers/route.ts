import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  saveResponseAnswers,
  FormClosedError,
  ResponseAlreadySubmittedError,
  ResponseNotFoundError,
  StaleResponseWriteError,
} from "@/domains/responses";
import { hitRateLimit } from "@/domains/abuse";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  apiError,
  getClientIp,
  readJsonBody,
  writeDenied,
  ANSWERS_BODY_BYTES,
} from "../../shared";

const AnswersBody = z.object({
  clientRevision: z.number().int().nonnegative(),
  lastQuestionId: z.string().min(1).max(64),
  answers: z.record(z.string(), z.unknown()),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError("invalid_body", "Invalid response id.", 400);
  }

  const body = await readJsonBody(request, ANSWERS_BODY_BYTES);
  if (body === null)
    return apiError(
      "invalid_body",
      "These answers are too long to send. Shorten the longest one and try again.",
      400,
    );

  const parsed = AnswersBody.safeParse(body);
  if (!parsed.success) return apiError("invalid_body", "Invalid request.", 400);

  const rateLimitKey = `answers:${getClientIp(request)}:${id}`;
  const rateLimit = await hitRateLimit(
    createAdminClient(),
    rateLimitKey,
    120,
    10 * 60 * 1000,
  );
  if (!rateLimit.allowed) {
    return apiError("rate_limited", "Too many attempts. Please try again shortly.", 429);
  }

  try {
    const admin = createAdminClient();
    // Only the browser that started it may change it (QA FC4-14).
    const denied = await writeDenied(request, admin, id);
    if (denied) return denied;
    const result = await saveResponseAnswers(
      admin,
      id,
      parsed.data.clientRevision,
      parsed.data.lastQuestionId,
      parsed.data.answers,
    );
    return NextResponse.json({ status: result.status, revision: result.revision });
  } catch (error) {
    if (error instanceof ResponseNotFoundError) {
      return apiError("not_found", "Response not found.", 404);
    }
    if (error instanceof ResponseAlreadySubmittedError) {
      return apiError("already_submitted", "This response was already submitted.", 409);
    }
    if (error instanceof FormClosedError) {
      return NextResponse.json(
        {
          error: {
            code: "form_closed",
            reason: error.reason,
            message: error.respondentMessage,
          },
        },
        { status: 410 },
      );
    }
    if (error instanceof StaleResponseWriteError) {
      return NextResponse.json(
        {
          error: {
            code: "stale",
            message: "A newer answer was already saved for this response.",
          },
          currentRevision: error.currentRevision,
        },
        { status: 409 },
      );
    }
    return apiError("unknown", "Something went wrong. Please try again.", 500);
  }
}
