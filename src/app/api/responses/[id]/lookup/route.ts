import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { hitRateLimit } from "@/domains/abuse";
import { runLookups } from "@/domains/integrations/lookups";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, getClientIp, readJsonBody } from "../../shared";

/**
 * External data during a response (logic spec phase 24). After a
 * question that triggers a lookup, the browser asks here; the server
 * calls the creator's API and returns the URL fields it filled in
 * (`{ values }`, empty when there's nothing — never an error the form
 * has to handle). Where the request goes is fixed by the creator's
 * saved lookup; the respondent's answers only fill in its path or query.
 */
const Body = z.object({
  questionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  answers: z
    .record(z.string().max(64), z.unknown())
    .refine((a) => Object.keys(a).length <= 250, "too many answers"),
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
    `lookup:${getClientIp(request)}:${id}`,
    20,
    3_600_000,
  );
  if (!limit.allowed) return NextResponse.json({ values: {} });
  try {
    return NextResponse.json({
      values: await runLookups(admin, id, parsed.data.questionId, parsed.data.answers),
    });
  } catch {
    return NextResponse.json({ values: {} });
  }
}
