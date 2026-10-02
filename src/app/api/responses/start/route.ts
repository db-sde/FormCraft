import { z } from "zod";
import { SEED_PATTERN } from "@/domains/logic/random";
import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { startResponse, FormNotAvailableError } from "@/domains/responses";
import { recordAnalyticsEvent } from "@/domains/analytics";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { hitRateLimit } from "@/domains/abuse";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, getClientIp, readJsonBody } from "../shared";

const StartBody = z.object({
  formId: z.string().uuid(),
  referrer: z.string().max(2000).optional(),
  utmSource: z.string().max(200).optional(),
  utmMedium: z.string().max(200).optional(),
  utmCampaign: z.string().max(200).optional(),
  utmTerm: z.string().max(200).optional(),
  utmContent: z.string().max(200).optional(),
  embedded: z.boolean().optional(),
  /** The form's hidden fields from its URL; undeclared names are dropped. */
  hidden: z
    .record(z.string().max(40), z.string().max(500))
    .refine((v) => Object.keys(v).length <= 20, "too many hidden fields")
    .optional(),
  /** The browser's random seed (question pools, option order). */
  seed: z.string().regex(SEED_PATTERN).optional(),
});

export async function POST(request: NextRequest) {
  const body = await readJsonBody(request);
  if (body === null)
    return apiError("invalid_body", "Request body is missing or too large.", 400);

  const parsed = StartBody.safeParse(body);
  if (!parsed.success) return apiError("invalid_body", "Invalid request.", 400);

  const rateLimitKey = `start:${getClientIp(request)}:${parsed.data.formId}`;
  const rateLimit = await hitRateLimit(
    createAdminClient(),
    rateLimitKey,
    // Generous: a school, office or event shares one address, and each
    // respondent starts a form exactly once.
    120,
    10 * 60 * 1000,
  );
  if (!rateLimit.allowed) {
    return apiError("rate_limited", "Too many attempts. Please try again shortly.", 429);
  }

  try {
    const admin = createAdminClient();
    const result = await startResponse(admin, parsed.data.formId, {
      referrer: parsed.data.referrer,
      utmSource: parsed.data.utmSource,
      utmMedium: parsed.data.utmMedium,
      utmCampaign: parsed.data.utmCampaign,
      utmTerm: parsed.data.utmTerm,
      utmContent: parsed.data.utmContent,
      embedded: parsed.data.embedded,
      hidden: parsed.data.hidden,
      seed: parsed.data.seed,
    });

    // A response row only gets created here — never on a resumed
    // session (see PublicFormRuntime) — so this is exactly the "valid
    // start" count computeCompletionRate/computeFunnelSummary expect.
    after(async () => {
      try {
        await recordAnalyticsEvent(admin, {
          formId: parsed.data.formId,
          eventType: "form_started",
          sessionId: result.responseId,
        });
      } catch {
        // Analytics must never affect the respondent-facing result.
      }
      await captureServerEvent({
        distinctId: result.responseId,
        event: "form_started",
        properties: { formId: parsed.data.formId },
      });
    });

    return NextResponse.json({
      responseId: result.responseId,
      formVersionId: result.formVersionId,
    });
  } catch (error) {
    if (error instanceof FormNotAvailableError) {
      return apiError(
        "form_not_available",
        "This form is not currently accepting responses.",
        404,
      );
    }
    return apiError("unknown", "Something went wrong. Please try again.", 500);
  }
}
