import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { hitRateLimit } from "@/domains/abuse";
import { runningScores } from "@/domains/responses/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, getClientIp, readJsonBody, writeDenied } from "../../shared";

/**
 * Scores so far, for a form that shows a score part-way through without
 * branching on it (QA FC15-45). Such a form's page isn't sent the option
 * points, so the browser asks here with the answers and the path taken,
 * and shows what the server works out from the stored form.
 */
const Body = z.object({
  answers: z
    .record(z.string().max(64), z.unknown())
    .refine((a) => Object.keys(a).length <= 250, "too many answers"),
  path: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(250),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = Body.safeParse(await readJsonBody(request));
  if (!z.string().uuid().safeParse(id).success || !parsed.success)
    return apiError("invalid_body", "Invalid request.", 400);
  const admin = createAdminClient();
  const limit = await hitRateLimit(
    admin,
    `scores:${getClientIp(request)}:${id}`,
    120,
    3_600_000,
  );
  if (!limit.allowed) return apiError("rate_limited", "Too many requests.", 429);
  // Only the browser that started it may ask (QA FC4-14).
  const denied = await writeDenied(request, admin, id);
  if (denied) return denied;
  const variables = await runningScores(
    admin,
    id,
    parsed.data.answers as never,
    parsed.data.path,
  );
  if (!variables) return apiError("not_found", "Response not found.", 404);
  return NextResponse.json({ variables });
}
