import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { loadCredential } from "@/domains/integrations/credentials";
import { confirmAttemptPaid, markAttemptFailed, recordRefund } from "./flow";
import {
  fetchRazorpayPayment,
  paymentSettled,
  verifyCheckoutSignature,
  type RazorpayPayment,
  type RazorpaySecrets,
} from "./razorpay";

type Client = SupabaseClient<Database>;

async function attemptFor(admin: Client, orderId: string) {
  const { data } = await admin
    .from("payment_attempts")
    .select("response_id, amount, status, provider, forms!inner(workspace_id)")
    .eq("provider_ref", orderId)
    .eq("provider", "razorpay")
    .maybeSingle();
  if (!data) return null;
  return {
    responseId: data.response_id,
    amount: data.amount,
    status: data.status,
    workspaceId: (data.forms as { workspace_id: string }).workspace_id,
  };
}

/**
 * What Checkout reports in the respondent's browser, checked on the
 * server (F-35): the signature must be Razorpay's for this order and
 * payment, and Razorpay's own record must show the payment captured for
 * this order and amount. Only then is it paid.
 */
export async function verifyRazorpayCheckout(
  admin: Client,
  input: { responseId: string; orderId: string; paymentId: string; signature: string },
  fetchImpl: typeof fetch = fetch,
): Promise<"paid" | "pending" | "failed" | "invalid"> {
  const attempt = await attemptFor(admin, input.orderId);
  if (!attempt || attempt.responseId !== input.responseId) return "invalid";
  if (attempt.status === "paid") return "paid";
  const secrets = await loadCredential<RazorpaySecrets>(
    admin,
    attempt.workspaceId,
    "razorpay",
  );
  if (!secrets || !verifyCheckoutSignature(input, secrets.keySecret)) return "invalid";
  const payment = await fetchRazorpayPayment(secrets, input.paymentId, fetchImpl);
  if (!payment.ok) return "pending";
  return settle(admin, attempt, input.orderId, payment.data);
}

async function settle(
  admin: Client,
  attempt: { amount: number; status: string },
  orderId: string,
  payment: RazorpayPayment,
): Promise<"paid" | "pending" | "failed" | "invalid"> {
  if (payment.order_id !== orderId || payment.amount !== attempt.amount) return "invalid";
  if (paymentSettled(payment)) {
    await confirmAttemptPaid(admin, orderId, payment.id);
    return "paid";
  }
  if (payment.status === "failed") {
    if (attempt.status !== "paid") {
      await markAttemptFailed(
        admin,
        orderId,
        "failed",
        payment.error_description ?? null,
      );
    }
    return "failed";
  }
  return "pending";
}

type Entity<T> = { entity?: T };
export type RazorpayEvent = {
  event: string;
  payload?: {
    payment?: Entity<RazorpayPayment>;
    order?: Entity<{ id: string }>;
    refund?: Entity<{ payment_id: string; amount: number }>;
  };
};

/**
 * Applies a verified Razorpay webhook for a workspace. Duplicates and
 * out-of-order events leave one correct state: a failure after a capture
 * changes nothing; a capture after a failure (a retry within the same
 * order) is paid. Refunds made in Razorpay are recorded.
 */
export async function applyRazorpayEvent(
  admin: Client,
  workspaceId: string,
  event: RazorpayEvent,
): Promise<"updated" | "ignored"> {
  const payment = event.payload?.payment?.entity;
  if (event.event === "refund.processed" || event.event === "refund.created") {
    const refund = event.payload?.refund?.entity;
    const paymentId = refund?.payment_id ?? payment?.id;
    const total =
      typeof payment?.amount_refunded === "number"
        ? payment.amount_refunded
        : (refund?.amount ?? 0);
    if (!paymentId || !total) return "ignored";
    // Only this workspace's payments.
    const { data: attempt } = await admin
      .from("payment_attempts")
      .select("forms!inner(workspace_id)")
      .eq("provider", "razorpay")
      .eq("provider_payment_id", paymentId)
      .maybeSingle();
    if (
      (attempt?.forms as { workspace_id: string } | undefined)?.workspace_id !==
      workspaceId
    )
      return "ignored";
    return recordRefund(admin, "razorpay", paymentId, total);
  }
  if (!payment?.order_id) return "ignored";
  if (!["payment.captured", "order.paid", "payment.failed"].includes(event.event))
    return "ignored";
  const attempt = await attemptFor(admin, payment.order_id);
  if (!attempt || attempt.workspaceId !== workspaceId) return "ignored";
  // Already paid: a repeat, or a failure arriving late, changes nothing.
  if (attempt.status === "paid") return "ignored";
  const outcome = await settle(admin, attempt, payment.order_id, {
    ...payment,
    // order.paid carries the captured payment.
    status: event.event === "order.paid" ? "captured" : payment.status,
  });
  return outcome === "invalid" || outcome === "pending" ? "ignored" : "updated";
}
