import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { hitRateLimit } from "@/domains/abuse";
import { createResumeLink, ResumeUnavailableError } from "@/domains/responses/resume";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, getClientIp } from "../../shared";

/**
 * "Finish later" (PRD P2.8): a resume link for an unfinished response.
 * The response id is the respondent's bearer secret here, as for saving
 * answers; whether links are allowed is decided on the server.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError("invalid_body", "Invalid response id.", 400);
  }
  const admin = createAdminClient();
  const limit = await hitRateLimit(
    admin,
    `resume:${getClientIp(request)}`,
    20,
    3_600_000,
  );
  if (!limit.allowed) {
    return apiError("rate_limited", "Too many links. Please try again later.", 429);
  }
  try {
    return NextResponse.json(await createResumeLink(admin, id));
  } catch (error) {
    if (error instanceof ResumeUnavailableError) {
      return apiError("unavailable", error.message, 409);
    }
    return apiError("unknown", "Something went wrong. Please try again.", 500);
  }
}
