import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicFormBySlug } from "@/domains/forms";
import { refreshFromStripe } from "@/domains/payments";
import { formatAmount } from "@/domains/payments/config";
import { quotePayment } from "@/domains/payments/flow";
import { createAdminClient } from "@/lib/supabase/admin";
import { Stage, stageDescClass, stageTitleClass } from "@/components/runtime/stage";
import { PayNow } from "./pay-now";

export const metadata: Metadata = { title: "Payment", robots: { index: false } };

/**
 * A response's payment page (P2.17, F-22): where Stripe sends the
 * respondent back, and the "pay later" link from the form. What it shows
 * comes from the server's own records (and, for a Stripe return, from
 * asking Stripe) — arriving here proves nothing. An unpaid response can
 * be paid from here, with either provider.
 */
export default async function PaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ session_id?: string; response?: string; canceled?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const admin = createAdminClient();
  const form = await getPublicFormBySlug(admin, slug);
  if (!form) notFound();

  let responseId: string | null = null;
  if (query.session_id) {
    await refreshFromStripe(admin, form.workspaceId, query.session_id);
    const { data: attempt } = await admin
      .from("payment_attempts")
      .select("response_id, form_id")
      .eq("provider_ref", query.session_id)
      .maybeSingle();
    const { data: legacy } = attempt
      ? { data: null }
      : await admin
          .from("payments")
          .select("response_id, form_id")
          .eq("checkout_session_id", query.session_id)
          .maybeSingle();
    const found = attempt ?? legacy;
    if (found?.form_id === form.formId) responseId = found.response_id;
  } else if (query.response && /^[0-9a-f-]{36}$/.test(query.response)) {
    const { data } = await admin
      .from("responses")
      .select("id, form_id")
      .eq("id", query.response)
      .maybeSingle();
    if (data?.form_id === form.formId) responseId = data.id;
  }
  if (!responseId) notFound();

  const { data: payment } = await admin
    .from("payments")
    .select("status, amount, currency, refunded_amount")
    .eq("response_id", responseId)
    .maybeSingle();
  const theme = form.compiled.schema.theme;
  const paid = payment?.status === "paid" || payment?.status === "refunded";
  const quote = paid ? null : await quotePayment(admin, responseId);
  if (!paid && !quote?.ok && !payment) notFound();
  const money = payment ? formatAmount(payment.amount, payment.currency) : "";
  const failed =
    Boolean(query.canceled) ||
    payment?.status === "failed" ||
    payment?.status === "expired" ||
    payment?.status === "canceled";

  return (
    <Stage theme={theme} className="min-h-dvh">
      <div className="flex flex-col items-start gap-4">
        {paid ? (
          <>
            <h1 className={stageTitleClass}>Payment received</h1>
            <p className={stageDescClass}>
              {payment?.status === "refunded"
                ? `The ${money} payment was refunded.`
                : `Thank you — ${money} was paid and your answers are in. You can close this page.`}
            </p>
          </>
        ) : payment?.status === "pending" && query.session_id && !query.canceled ? (
          <>
            <h1 className={stageTitleClass}>Payment is processing</h1>
            <p className={stageDescClass}>
              The payment hasn&apos;t been confirmed yet. Your answers are saved; this
              page will show the result when you reload it.
            </p>
          </>
        ) : (
          <>
            <h1 className={stageTitleClass}>
              {failed ? "The payment didn't go through" : "Complete your payment"}
            </h1>
            <p className={stageDescClass}>
              {quote?.ok
                ? `Your answers are saved, but the ${formatAmount(quote.quote.total, quote.quote.currency)} payment ${failed ? "wasn't completed" : "is still due"}.`
                : "Your answers are saved, but this payment can't be taken right now."}
            </p>
            {quote?.ok && (
              <PayNow
                theme={theme}
                responseId={responseId}
                quote={quote.quote}
                label={failed ? "Try the payment again" : "Pay now"}
              />
            )}
          </>
        )}
      </div>
    </Stage>
  );
}
