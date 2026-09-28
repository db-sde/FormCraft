import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { completeResponse, ResponseNotFoundError } from "@/domains/responses";
import { checkRateLimit } from "@/domains/abuse";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, getClientIp, readJsonBody } from "../../shared";

const CompleteBody = z.object({
  clientRevision: z.number().int().nonnegative(),
  lastQuestionId: z.string().min(1).max(64),
  answers: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().uuid(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError("invalid_body", "Invalid response id.", 400);
  }

  const body = await readJsonBody(request);
  if (body === null)
    return apiError("invalid_body", "Request body is missing or too large.", 400);

  const parsed = CompleteBody.safeParse(body);
  if (!parsed.success) return apiError("invalid_body", "Invalid request.", 400);

  const rateLimitKey = `complete:${getClientIp(request)}:${id}`;
  const rateLimit = checkRateLimit(rateLimitKey, 10, 10 * 60 * 1000);
  if (!rateLimit.allowed) {
    return apiError("rate_limited", "Too many attempts. Please try again shortly.", 429);
  }

  try {
    const admin = createAdminClient();
    const result = await completeResponse(
      admin,
      id,
      parsed.data.clientRevision,
      parsed.data.lastQuestionId,
      parsed.data.answers,
      parsed.data.idempotencyKey,
    );

    if (!result.ok) {
      return NextResponse.json(
        {
          error: {
            code: result.code,
            message: "Please answer all required questions before submitting.",
            missingQuestionIds: result.missingQuestionIds,
          },
        },
        { status: 400 },
      );
    }

    return NextResponse.json({ endingId: result.endingId });
  } catch (error) {
    if (error instanceof ResponseNotFoundError) {
      return apiError("not_found", "Response not found.", 404);
    }
    return apiError("unknown", "Something went wrong. Please try again.", 500);
  }
}
