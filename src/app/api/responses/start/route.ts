import { z } from "zod";
import { SEED_PATTERN } from "@/domains/logic/random";
import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import {
  startResponse,
  FormClosedError,
  FormNotAvailableError,
} from "@/domains/responses";
import { isUnlocked, unlockCookieName } from "@/domains/forms/access";
import { recordAnalyticsEvent } from "@/domains/analytics";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { hitRateLimit } from "@/domains/abuse";
import { createAdminClient } from "@/lib/supabase/admin";
import { VISITOR_COOKIE, VISITOR_ID_PATTERN } from "@/domains/experiments/visitor";
import { writeSecretCookie } from "@/domains/responses/write-secret";
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
  /** The language the respondent is filling the form in (P2.21). */
  language: z
    .string()
    .regex(/^[a-z]{2}$/)
    .optional(),
  /** The A/B test whose link served the form (P3.9). */
  experimentId: z.string().uuid().optional(),
  /** The in-form variant test and arm the page served (F-29). */
  variantTestId: z.string().uuid().optional(),
  variant: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
  /** A kiosk session (F-15): one device, many people, so the response
   * isn't tied to the device's visitor id. */
  kiosk: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const body = await readJsonBody(request);
  if (body === null)
    return apiError("invalid_body", "Request body is missing or too large.", 400);

  const parsed = StartBody.safeParse(body);
  if (!parsed.success) return apiError("invalid_body", "Invalid request.", 400);

  // Per address: a burst limit (QA FC4-03) and a generous overall one —
  // a school, office or event shares one address. The browser waits and
  // tries again when it's turned away, so a class starting together is
  // only slowed, never refused.
  const ip = getClientIp(request);
  for (const [key, limit, windowMs] of [
    [`start-burst:${ip}:${parsed.data.formId}`, 20, 60 * 1000],
    [`start:${ip}:${parsed.data.formId}`, 120, 10 * 60 * 1000],
  ] as const) {
    if (!(await hitRateLimit(createAdminClient(), key, limit, windowMs)).allowed) {
      const refused = apiError(
        "rate_limited",
        "Too many attempts. Please try again shortly.",
        429,
      );
      refused.headers.set("Retry-After", "10");
      return refused;
    }
  }
  // Tighter per visitor (QA FC4-03): one browser starting the same form
  // over and over is a script, not a respondent. The per-address limit
  // above is the backstop for callers without the visitor cookie.
  const visitor = request.cookies.get(VISITOR_COOKIE)?.value;
  if (visitor && VISITOR_ID_PATTERN.test(visitor)) {
    const perVisitor = await hitRateLimit(
      createAdminClient(),
      `start-visitor:${visitor}:${parsed.data.formId}`,
      10,
      10 * 60 * 1000,
    );
    if (!perVisitor.allowed) {
      return apiError(
        "rate_limited",
        "Too many attempts. Please try again shortly.",
        429,
      );
    }
  }

  try {
    const admin = createAdminClient();
    const unlock = request.cookies.get(unlockCookieName(parsed.data.formId))?.value;
    if (!(await isUnlocked(admin, parsed.data.formId, unlock))) {
      return apiError("locked", "Enter the form's password to continue.", 403);
    }
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
      language: parsed.data.language,
      experimentId: parsed.data.experimentId,
      variantTestId: parsed.data.variantTestId,
      variant: parsed.data.variant,
      // From the cookie, never the body: it's httpOnly, so a page script
      // can't choose whose remembered answers a response updates.
      visitorId: parsed.data.kiosk
        ? undefined
        : request.cookies.get(VISITOR_COOKIE)?.value,
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

    const response = NextResponse.json({
      responseId: result.responseId,
      formVersionId: result.formVersionId,
    });
    // The response's write secret, for this browser only (QA FC4-14).
    const secret = writeSecretCookie(
      result.responseId,
      request.nextUrl.protocol === "https:",
    );
    response.cookies.set(secret.name, secret.value, secret.options);
    return response;
  } catch (error) {
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
