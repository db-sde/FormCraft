import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { loadCredential } from "@/domains/integrations/credentials";
import { confirmAttemptPaid, markAttemptFailed, recordRefund } from "./flow";
import { stripeApiBase, type Session, type StripeSecrets } from "./stripe";

type Client = SupabaseClient<Database>;

const STATUS_FOR_EVENT: Record<string, "paid" | "failed" | "expired" | undefined> = {
  "checkout.session.completed": "paid",
  "checkout.session.async_payment_succeeded": "paid",
  "checkout.session.async_payment_failed": "failed",
  "checkout.session.expired": "expired",
};

type StripeEvent = {
  type: string;
  data: {
    object: Session & { amount_refunded?: number };
  };
};

/**
 * Applies a verified Stripe event to the attempt it's about (P2.17,
 * F-22): duplicates and out-of-order events leave one correct state — a
 * paid payment never goes back. Refunds made in Stripe are recorded.
 */
export async function applyStripeEvent(
  admin: Client,
  event: StripeEvent,
): Promise<"updated" | "ignored"> {
  const object = event.data?.object;
  if (event.type === "charge.refunded") {
    const intent = object?.payment_intent;
    if (typeof intent !== "string" || typeof object.amount_refunded !== "number")
      return "ignored";
    return recordRefund(admin, "stripe", intent, object.amount_refunded);
  }
  const status = STATUS_FOR_EVENT[event.type];
  if (!status || !object?.id) return "ignored";
  // "completed" with a delayed payment method isn't paid yet.
  if (event.type === "checkout.session.completed" && object.payment_status !== "paid") {
    return "ignored";
  }
  const { data: attempt } = await admin
    .from("payment_attempts")
    .select("response_id, status")
    .eq("provider_ref", object.id)
    .maybeSingle();
  if (attempt) {
    if (
      object.metadata?.response_id &&
      object.metadata.response_id !== attempt.response_id
    )
      return "ignored";
    if (status === "paid") {
      const outcome = await confirmAttemptPaid(
        admin,
        object.id,
        object.payment_intent ?? null,
      );
      return outcome === "paid" || outcome === "duplicate" ? "updated" : "ignored";
    }
    if (attempt.status === "paid") return "ignored";
    await markAttemptFailed(admin, object.id, status);
    return "updated";
  }
  return applyLegacy(admin, status, object);
}

/** Sessions started before payment attempts existed (migration 52). */
async function applyLegacy(
  admin: Client,
  status: "paid" | "failed" | "expired",
  session: Session,
): Promise<"updated" | "ignored"> {
  const { data: payment } = await admin
    .from("payments")
    .select("response_id, status")
    .eq("checkout_session_id", session.id)
    .maybeSingle();
  if (!payment || payment.status === "paid" || payment.status === "refunded")
    return "ignored";
  if (
    session.metadata?.response_id &&
    session.metadata.response_id !== payment.response_id
  )
    return "ignored";
  const next =
    status !== "paid" && payment.status !== "pending" ? payment.status : status;
  await admin
    .from("payments")
    .update({
      status: next,
      paid_at: next === "paid" ? new Date().toISOString() : null,
      provider_payment_id: next === "paid" ? (session.payment_intent ?? null) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("response_id", payment.response_id);
  return "updated";
}

/** Asks Stripe about a session (when the respondent comes back) and
 * records what Stripe says. */
export async function refreshFromStripe(
  admin: Client,
  workspaceId: string,
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<"paid" | "pending" | "failed" | "expired" | "canceled" | "refunded" | null> {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return null;
  const secrets = await loadCredential<StripeSecrets>(admin, workspaceId, "stripe");
  if (!secrets) return null;
  const res = await fetchImpl(`${stripeApiBase()}/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${secrets.secretKey}` },
  }).catch(() => null);
  if (!res?.ok) return null;
  const session = (await res.json()) as Session;
  if (session.payment_status === "paid") {
    await applyStripeEvent(admin, {
      type: "checkout.session.completed",
      data: { object: session },
    });
  } else if (session.status === "expired") {
    await applyStripeEvent(admin, {
      type: "checkout.session.expired",
      data: { object: session },
    });
  }
  const { data: attempt } = await admin
    .from("payment_attempts")
    .select("response_id")
    .eq("provider_ref", sessionId)
    .maybeSingle();
  const { data } = attempt
    ? await admin
        .from("payments")
        .select("status")
        .eq("response_id", attempt.response_id)
        .maybeSingle()
    : await admin
        .from("payments")
        .select("status")
        .eq("checkout_session_id", sessionId)
        .maybeSingle();
  return (data?.status as never) ?? null;
}
