import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { completeResponse, ResponseNotFoundError } from "@/domains/responses";
import { notifyFormOwnerOfCompletedResponse } from "@/domains/notifications";
import { sendConfirmationEmail } from "@/domains/notifications/confirmation";
import { quotePayment } from "@/domains/payments/flow";
import { enqueueWebhookDeliveries, dispatchDueDeliveries } from "@/domains/webhooks";
import { enqueueSheetsSync, dispatchDueSheetsSyncs } from "@/domains/sheets";
import { recordAnalyticsEvent } from "@/domains/analytics";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { hitRateLimit } from "@/domains/abuse";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, getClientIp, readJsonBody } from "../../shared";
import { rememberProfile } from "@/domains/responses/profile";
import { markCaptchaVerified, submissionGuards } from "@/domains/responses/guards";
import { isUnlocked, unlockCookieName } from "@/domains/forms/access";
import { verifyTurnstile } from "@/domains/abuse/turnstile";
import { emailEvent, logResponseEvent } from "@/domains/responses/timeline";
import { saveOrder } from "@/domains/responses/orders";
import { issueDocumentsForResponse } from "@/domains/documents/issue";
import { sendRuleEmails } from "@/domains/notifications/rules";
import { emailConfirmed, holdBookings, settleBookings } from "@/domains/bookings/submit";
import { enqueueConnectorSyncs } from "@/domains/connectors/links";
import "@/domains/connectors/registry";

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
  /** Cloudflare Turnstile token, when the form requires the check. */
  captchaToken: z.string().max(4096).optional(),
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
    const guards = await submissionGuards(admin, id);
    if (!guards) return apiError("not_found", "Response not found.", 404);

    // A retry of a submit that already went through skips these: it
    // must succeed even after the password changed or the token expired.
    if (!guards.completed) {
      const unlock = request.cookies.get(unlockCookieName(guards.formId))?.value;
      if (!(await isUnlocked(admin, guards.formId, unlock))) {
        return apiError("locked", "Enter the form's password to continue.", 403);
      }
      if (guards.needsCaptcha) {
        const check = await verifyTurnstile(parsed.data.captchaToken, {
          remoteIp: getClientIp(request),
        });
        if (!check.ok) {
          // Counted in the logs, never with answers or the token.
          console.warn(
            JSON.stringify({
              event: "captcha_failed",
              formId: guards.formId,
              reason: check.reason,
              codes: check.codes ?? [],
            }),
          );
          const ours =
            check.reason === "unavailable" || check.reason === "not_configured";
          return apiError(
            ours ? "captcha_unavailable" : "captcha_failed",
            ours
              ? "We couldn't run the security check. Please try again in a moment."
              : "Please complete the security check, then submit again.",
            ours ? 503 : 400,
          );
        }
        await markCaptchaVerified(admin, id);
      }
    }

    // Bookings (F-27): hold the chosen slot before the response
    // completes; a slot that's gone is an answer error.
    const holds = await holdBookings(admin, id, parsed.data.answers);
    if (!holds.ok) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_answer",
            message: "Some answers need fixing before you can submit.",
            missingQuestionIds: holds.errors.map((e) => e.questionId),
            errors: holds.errors,
          },
        },
        { status: 400 },
      );
    }

    const result = await completeResponse(
      admin,
      id,
      parsed.data.clientRevision,
      parsed.data.lastQuestionId,
      parsed.data.answers,
      parsed.data.idempotencyKey,
      { spamSuspected: Boolean(parsed.data.trap) },
    );
    // Confirmed or released before the reply, so the booking and the
    // response never disagree.
    const confirmedBookings = await settleBookings(admin, holds.held, id, result.ok);

    if (!result.ok && result.code === "form_closed") {
      return NextResponse.json(
        {
          error: { code: "form_closed", reason: result.reason, message: result.message },
        },
        { status: 410 },
      );
    }
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
        await emailConfirmed(admin, confirmedBookings).catch(() => null);
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
        await step(() => rememberProfile(admin, id));
        // Emails go on the response's timeline (F-31) with their outcome.
        const logEmail = async (
          kind: "email_owner" | "email_respondent",
          result: Parameters<typeof emailEvent>[0],
        ) => {
          const event = emailEvent(result);
          if (!event) return;
          await logResponseEvent(admin, {
            responseId: id,
            kind,
            outcome: event.outcome,
            detail: event.reason ? { reason: event.reason } : {},
          });
        };
        await step(async () =>
          logEmail(
            "email_owner",
            await notifyFormOwnerOfCompletedResponse(admin, result.formId, id),
          ),
        );
        await step(async () =>
          logEmail("email_respondent", await sendConfirmationEmail(admin, id)),
        );
        // Confidential feedback (F-30): nothing that carries individual
        // answers leaves (webhooks and their Slack/HubSpot/Zapier kinds,
        // Sheets, PDFs, rule emails). The owner's alert has no answers.
        const { data: formRow } = await admin
          .from("forms")
          .select("confidential")
          .eq("id", result.formId)
          .maybeSingle();
        if (formRow?.confidential) return;
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
        // PDF documents (F-07): numbered and emailed once; failures are
        // on the response's timeline.
        await step(() => issueDocumentsForResponse(admin, id));
        // Notification rules (F-25): teammates, by condition.
        await step(() => sendRuleEmails(admin, id));
        // Business apps (Phase 6): one job per linked app, run now; the
        // connectors cron retries and recovers.
        await step(() => enqueueConnectorSyncs(admin, id));
      });
    }

    // The order from any product blocks (F-04), priced by the server.
    // Saved before the reply so the response and its order arrive
    // together. A failure never fails the submission; a repeat submit
    // (same idempotency key) tries again, and saving is idempotent.
    if (!parsed.data.trap) {
      await saveOrder(createAdminClient(), id).catch(() => null);
    }

    // Payment (P2.17, F-22): the response is already saved; the server
    // works out what's owed and the form shows its payment step.
    const payment = parsed.data.trap
      ? null
      : await quotePayment(createAdminClient(), id).catch(() => ({
          ok: false as const,
          message: "The payment couldn't be started.",
        }));
    const owes =
      payment?.ok && payment.status !== "paid" && payment.status !== "refunded";
    const { data: formSlug } = owes
      ? await createAdminClient()
          .from("forms")
          .select("slug")
          .eq("id", result.formId)
          .maybeSingle()
      : { data: null };

    return NextResponse.json({
      endingId: result.endingId,
      // The respondent pays in the form's payment step (F-22).
      ...(owes
        ? {
            payment: {
              quote: payment.quote,
              // Where to come back and pay later (the response id is the
              // respondent's own, unguessable).
              payLater: formSlug ? `/f/${formSlug.slug}/payment?response=${id}` : null,
            },
          }
        : {}),
      ...(payment && !payment.ok ? { paymentError: payment.message } : {}),
    });
  } catch (error) {
    if (error instanceof ResponseNotFoundError) {
      return apiError("not_found", "Response not found.", 404);
    }
    return apiError("unknown", "Something went wrong. Please try again.", 500);
  }
}
