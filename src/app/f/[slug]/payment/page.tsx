import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicFormBySlug } from "@/domains/forms";
import { refreshFromStripe } from "@/domains/payments";
import { createAdminClient } from "@/lib/supabase/admin";
import { Stage, stageDescClass, stageTitleClass } from "@/components/runtime/stage";
import { RetryPayment } from "./retry-payment";

export const metadata: Metadata = { title: "Payment", robots: { index: false } };

/**
 * Where Stripe Checkout sends the respondent back (P2.17). What it shows
 * comes from Stripe, asked from the server — arriving here proves
 * nothing by itself. The signed webhook records the same result even if
 * the respondent never comes back.
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

  let payment: {
    response_id: string;
    status: string;
    amount: number;
    currency: string;
  } | null = null;
  if (query.session_id) {
    await refreshFromStripe(admin, form.workspaceId, query.session_id);
    const { data } = await admin
      .from("payments")
      .select("response_id, status, amount, currency, form_id")
      .eq("checkout_session_id", query.session_id)
      .maybeSingle();
    if (data?.form_id === form.formId) payment = data;
  } else if (query.response && /^[0-9a-f-]{36}$/.test(query.response)) {
    const { data } = await admin
      .from("payments")
      .select("response_id, status, amount, currency, form_id")
      .eq("response_id", query.response)
      .maybeSingle();
    if (data?.form_id === form.formId) payment = data;
  }
  if (!payment) notFound();

  const theme = form.compiled.schema.theme;
  const money = new Intl.NumberFormat("en", {
    style: "currency",
    currency: payment.currency.toUpperCase(),
  }).format(payment.amount / (payment.currency === "jpy" ? 1 : 100));

  return (
    <Stage theme={theme} className="min-h-dvh">
      <div className="flex flex-col items-start gap-4">
        {payment.status === "paid" ? (
          <>
            <h1 className={stageTitleClass}>Payment received</h1>
            <p className={stageDescClass}>
              Thank you — {money} was paid and your answers are in. You can close this
              page.
            </p>
          </>
        ) : payment.status === "pending" && !query.canceled ? (
          <>
            <h1 className={stageTitleClass}>Payment is processing</h1>
            <p className={stageDescClass}>
              Stripe hasn&apos;t confirmed the payment yet. Your answers are saved; this
              page will show the result when you reload it.
            </p>
          </>
        ) : (
          <>
            <h1 className={stageTitleClass}>The payment didn&apos;t go through</h1>
            <p className={stageDescClass}>
              Your answers are saved, but the {money} payment wasn&apos;t completed.
            </p>
            <RetryPayment responseId={payment.response_id} />
          </>
        )}
      </div>
    </Stage>
  );
}
