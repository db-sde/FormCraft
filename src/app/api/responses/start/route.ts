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

  // Limits (QA FC4-03). Per address alone isn't enough: a caller can
  // send each request from a different address (QA's tool did, through a
  // relay), so there are also limits it can't step around:
  // - a browser that opened the form has a visitor cookie: 10 starts per
  //   visitor per form every 10 minutes (a kiosk, many people on one
  //   device, is exempt from this one);
  // - a caller without the cookie (a script) shares one budget per form:
  //   20 a minute, whatever address it comes from;
  // - per address: a burst limit and a generous overall one, since a
  //   school or office shares one address.
  // The browser waits and tries again when it's turned away, so a class
  // starting together is only slowed, never refused.
  const ip = getClientIp(request);
  const formId = parsed.data.formId;
  const visitor = request.cookies.get(VISITOR_COOKIE)?.value;
  const hasVisitor = !!visitor && VISITOR_ID_PATTERN.test(visitor);
  const isKiosk =
    !!parsed.data.kiosk &&
    !!(
      await createAdminClient()
        .from("forms")
        .select("kiosk_config")
        .eq("id", formId)
        .maybeSingle()
    ).data?.kiosk_config;
  const limits: [string, number, number][] = [
    [`start-burst:${ip}:${formId}`, 20, 60 * 1000],
    [`start:${ip}:${formId}`, 120, 10 * 60 * 1000],
  ];
  if (!hasVisitor) limits.push([`start-anon:${formId}`, 20, 60 * 1000]);
  else if (!isKiosk)
    limits.push([`start-visitor:${visitor}:${formId}`, 10, 10 * 60 * 1000]);
  for (const [key, limit, windowMs] of limits) {
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
