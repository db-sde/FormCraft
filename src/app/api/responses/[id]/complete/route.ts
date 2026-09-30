import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { completeResponse, ResponseNotFoundError } from "@/domains/responses";
import { notifyFormOwnerOfCompletedResponse } from "@/domains/notifications";
import { enqueueWebhookDeliveries, dispatchDueDeliveries } from "@/domains/webhooks";
import { enqueueSheetsSync, dispatchDueSheetsSyncs } from "@/domains/sheets";
import { recordAnalyticsEvent } from "@/domains/analytics";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { checkRateLimit } from "@/domains/abuse";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, getClientIp, readJsonBody } from "../../shared";

const CompleteBody = z.object({
  clientRevision: z.number().int().nonnegative(),
  lastQuestionId: z.string().min(1).max(64),
  answers: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().uuid(),
  /** Hidden spam-trap field — people never see it, bots fill it. */
  website: z.string().max(2000).optional(),
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

  if (parsed.data.website) {
    // Looks like success to the bot (so it doesn't adapt), but nothing
    // is completed, notified, or delivered. The unfinished row is left
    // for retention cleanup.
    return NextResponse.json({ endingId: "", alreadyCompleted: false });
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

    if (!result.alreadyCompleted) {
      // Runs after the response has been sent to the respondent —
      // next/server's after() keeps the serverless function alive for
      // this, unlike a bare unawaited promise, which can be killed
      // before it finishes once the response is flushed. The canonical
      // write already succeeded above, so a failure in any of these
      // (missing API key, an unreachable webhook endpoint, ...) can
      // never affect the response itself (see ARCHITECTURE.md).
      after(async () => {
        try {
          await recordAnalyticsEvent(admin, {
            formId: result.formId,
            eventType: "form_submitted",
            sessionId: id,
            metadata: { endingId: result.endingId || null },
          });
        } catch {
          // Analytics must never block the notification/webhook side
          // effects that follow.
        }
        await captureServerEvent({
          distinctId: id,
          event: "form_submitted",
          properties: { formId: result.formId, endingId: result.endingId || null },
        });
        await notifyFormOwnerOfCompletedResponse(admin, result.formId, id);
        await enqueueWebhookDeliveries(
          admin,
          result.formId,
          id,
          result.endingId || null,
          parsed.data.answers,
        );
        // Attempt the just-enqueued (and any other due) deliveries
        // immediately rather than waiting for the next scheduled
        // sweep — see /api/cron/webhooks/dispatch for the sweep that
        // covers retries after this.
        await dispatchDueDeliveries(admin);

        try {
          const enqueued = await enqueueSheetsSync(admin, result.formId, id);
          if (enqueued) await dispatchDueSheetsSyncs(admin);
        } catch {
          // Sheets sync is the least mature of these integrations —
          // never let it take down the notification/webhook work above
          // it, which already succeeded by this point.
        }
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
