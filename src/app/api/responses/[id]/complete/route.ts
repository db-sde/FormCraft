import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { completeResponse, ResponseNotFoundError } from "@/domains/responses";
import { notifyFormOwnerOfCompletedResponse } from "@/domains/notifications";
import { sendConfirmationEmail } from "@/domains/notifications/confirmation";
import { enqueueWebhookDeliveries, dispatchDueDeliveries } from "@/domains/webhooks";
import { enqueueSheetsSync, dispatchDueSheetsSyncs } from "@/domains/sheets";
import { recordAnalyticsEvent } from "@/domains/analytics";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { hitRateLimit } from "@/domains/abuse";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, getClientIp, readJsonBody } from "../../shared";

const CompleteBody = z.object({
  clientRevision: z.number().int().nonnegative(),
  lastQuestionId: z.string().min(1).max(64),
  answers: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().uuid(),
  /** Hidden spam-trap field — people never see it, bots fill it. A
   * filled trap flags the response (it is never discarded: password
   * managers and browser autofill sometimes fill hidden fields, and a
   * real person must not lose their submission to that). */
  trap: z.string().max(2000).optional(),
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
  const rateLimit = await hitRateLimit(
    createAdminClient(),
    rateLimitKey,
    10,
    10 * 60 * 1000,
  );
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
      { spamSuspected: Boolean(parsed.data.trap) },
    );

    if (!result.ok) {
      return NextResponse.json(
        {
          error: {
            code: result.code,
            message:
              result.code === "missing_required"
                ? "Please answer all required questions before submitting."
                : "Some answers need fixing before you can submit.",
            missingQuestionIds: result.missingQuestionIds,
            errors: result.errors,
          },
        },
        { status: 400 },
      );
    }

    // Suspected spam is kept but quiet: no email, webhook, Sheets row, or
    // funnel event.
    if (!result.alreadyCompleted && !parsed.data.trap) {
      // Runs after the response has been sent to the respondent —
      // next/server's after() keeps the serverless function alive for
      // this, unlike a bare unawaited promise, which can be killed
      // before it finishes once the response is flushed. The canonical
      // write already succeeded above, so a failure in any of these
      // (missing API key, an unreachable webhook endpoint, ...) can
      // never affect the response itself (see ARCHITECTURE.md).
      after(async () => {
        // Each step is independent: one failing (analytics down, no
        // email key, a webhook consumer erroring) must not skip the
        // rest. Anything that still doesn't happen is picked up by the
        // cron recovery sweeps, which create the missing jobs.
        const step = async (work: () => Promise<unknown>) => {
          try {
            await work();
          } catch {
            // Intentionally swallowed — see above.
          }
        };
        await step(() =>
          recordAnalyticsEvent(admin, {
            formId: result.formId,
            eventType: "form_submitted",
            sessionId: id,
            metadata: { endingId: result.endingId || null },
          }),
        );
        await step(() =>
          captureServerEvent({
            distinctId: id,
            event: "form_submitted",
            properties: { formId: result.formId, endingId: result.endingId || null },
          }),
        );
        await step(() => notifyFormOwnerOfCompletedResponse(admin, result.formId, id));
        await step(() => sendConfirmationEmail(admin, id));
        await step(async () => {
          await enqueueWebhookDeliveries(admin, id);
          // Send right away rather than waiting for the next scheduled
          // sweep; the sweep covers retries.
          await dispatchDueDeliveries(admin);
        });
        await step(async () => {
          const enqueued = await enqueueSheetsSync(admin, result.formId, id);
          if (enqueued) await dispatchDueSheetsSyncs(admin);
        });
      });
    }

    return NextResponse.json({ endingId: result.endingId });
  } catch (error) {
    if (error instanceof ResponseNotFoundError) {
      return apiError("not_found", "Response not found.", 404);
    }
    return apiError("unknown", "Something went wrong. Please try again.", 500);
  }
}
