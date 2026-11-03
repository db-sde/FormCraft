import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import { getWorkspacePlan } from "@/domains/billing/entitlements";
import { walkForm } from "@/domains/logic/walk";
import { getOrder, saveOrder } from "@/domains/responses/orders";
import type { OrderLine } from "@/domains/forms/products";
import { loadCredential } from "@/domains/integrations/credentials";
import { logResponseEvent } from "@/domains/responses/timeline";
import { issueDocumentsForResponse } from "@/domains/documents/issue";
import {
  amountToCharge,
  chargeable,
  formatAmount,
  readPaymentConfig,
  type PaymentConfig,
  type PaymentProvider,
} from "./config";
import { applyCoupon, couponFromRow, describeCoupon, normalizeCode } from "./coupons";
import {
  createRazorpayOrder,
  isTestKey,
  razorpayCheckoutScript,
  type RazorpaySecrets,
} from "./razorpay";
import { createCheckout, expireCheckout, type StripeSecrets } from "./stripe";

type Client = SupabaseClient<Database>;

/**
 * Taking payment for a completed response (master spec F-22/F-35), the
 * same way for every provider:
 *
 * - The amount is worked out here from the response's own version and
 *   answers (a fixed price, a calculated variable or the product order),
 *   less one coupon, checked here too — never from the browser.
 * - Each try is a `payment_attempts` row with the provider's id (a
 *   Razorpay order, a Stripe Checkout Session). An open attempt for the
 *   same amount is reused rather than a second one made, and an
 *   already-paid response can't start another.
 * - Paid is recorded only from a check the server made (a signed webhook,
 *   a verified Checkout signature plus the provider's record, or asking
 *   the provider), atomically, once (`record_payment_paid`); a paid
 *   payment never goes back (database trigger). A second payment for the
 *   same response is recorded and flagged on the timeline for a refund.
 * - Answers are saved before payment, so an unpaid response is kept and
 *   can be paid later (product owner, 2026-11-03).
 */

export type Quote = {
  provider: PaymentProvider;
  currency: string;
  description: string;
  lines: OrderLine[] | null;
  subtotal: number;
  discount: number;
  total: number;
  coupon: { code: string; label: string } | null;
  couponsAvailable: boolean;
};

type Payable = {
  responseId: string;
  formId: string;
  workspaceId: string;
  formTitle: string;
  config: PaymentConfig;
  subtotal: number;
  lines: OrderLine[] | null;
  paymentStatus: string | null;
};

/** The response's payment, or null when its form takes none. */
async function loadPayable(
  admin: Client,
  responseId: string,
): Promise<{ ok: true; payable: Payable } | { ok: false; message: string } | null> {
  const { data: response } = await admin
    .from("responses")
    .select(
      "id, form_id, form_version_id, hidden_fields, random_seed, completed_at, status, spam_suspected, forms!inner(workspace_id, title, payment_config)",
    )
    .eq("id", responseId)
    .maybeSingle();
  if (!response || response.status !== "completed" || response.spam_suspected)
    return null;
  const form = response.forms as {
    workspace_id: string;
    title: string;
    payment_config: unknown;
  };
  const config = readPaymentConfig(form.payment_config as never);
  if (!config) return null;
  const { entitlements } = await getWorkspacePlan(admin, form.workspace_id);
  if (!entitlements.payments) return null;

  const [{ data: version }, { data: answerRows }, { data: payment }] = await Promise.all([
    admin
      .from("form_versions")
      .select("schema")
      .eq("id", response.form_version_id)
      .single(),
    admin.from("answers").select("question_id, value").eq("response_id", responseId),
    admin.from("payments").select("status").eq("response_id", responseId).maybeSingle(),
  ]);
  if (!version) return null;
  const hidden = Object.fromEntries(
    Object.entries((response.hidden_fields ?? {}) as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  const walk = walkForm(
    compileFormSchema(parseFormSchema(version.schema)),
    Object.fromEntries((answerRows ?? []).map((a) => [a.question_id, a.value])),
    {
      hidden,
      seed: response.random_seed ?? undefined,
      now: response.completed_at ? new Date(response.completed_at) : undefined,
    },
  );
  // The order is saved on submit; saving again is a no-op.
  const order = config.fromOrder
    ? ((await getOrder(admin, responseId)) ?? (await saveOrder(admin, responseId)))
    : null;
  const amount = amountToCharge(config, walk.variables, order);
  if (!amount.ok) return { ok: false, message: amount.message };
  return {
    ok: true,
    payable: {
      responseId,
      formId: response.form_id,
      workspaceId: form.workspace_id,
      formTitle: form.title,
      config,
      subtotal: amount.minor,
      lines: order?.lines ?? null,
      paymentStatus: payment?.status ?? null,
    },
  };
}

type Priced = {
  quote: Quote;
  couponId: string | null;
  couponError?: string;
};

async function price(
  admin: Client,
  p: Payable,
  couponCode: string | null | undefined,
  now: number,
): Promise<Priced> {
  const { count } = await admin
    .from("coupons")
    .select("id", { count: "exact", head: true })
    .eq("form_id", p.formId)
    .eq("active", true);
  const base: Quote = {
    provider: p.config.provider,
    currency: p.config.currency,
    description: p.config.description,
    lines: p.lines,
    subtotal: p.subtotal,
    discount: 0,
    total: p.subtotal,
    coupon: null,
    couponsAvailable: (count ?? 0) > 0,
  };
  if (!couponCode?.trim()) return { quote: base, couponId: null };
  const code = normalizeCode(couponCode);
  const { data: row } = code
    ? await admin
        .from("coupons")
        .select("*")
        .eq("form_id", p.formId)
        .eq("code", code)
        .maybeSingle()
    : { data: null };
  const coupon = row ? couponFromRow(row) : null;
  const applied = applyCoupon(coupon, p.subtotal, now);
  if (!applied.ok) return { quote: base, couponId: null, couponError: applied.message };
  if (applied.total > 0 && !chargeable(p.config.provider, applied.total)) {
    return {
      quote: base,
      couponId: null,
      couponError: "With that code the amount is too small to charge.",
    };
  }
  return {
    quote: {
      ...base,
      discount: applied.discount,
      total: applied.total,
      coupon: {
        code: coupon!.code,
        label: describeCoupon(coupon!, (m) => formatAmount(m, p.config.currency)),
      },
    },
    couponId: coupon!.id,
  };
}

/** What the respondent owes, with a coupon if one is given. Null when
 * the response has nothing to pay. */
export async function quotePayment(
  admin: Client,
  responseId: string,
  couponCode?: string | null,
  now = Date.now(),
): Promise<
  | { ok: true; quote: Quote; status: string | null; couponError?: string }
  | { ok: false; message: string }
  | null
> {
  const loaded = await loadPayable(admin, responseId);
  if (!loaded || !loaded.ok) return loaded;
  const priced = await price(admin, loaded.payable, couponCode, now);
  return {
    ok: true,
    quote: priced.quote,
    status: loaded.payable.paymentStatus,
    ...(priced.couponError ? { couponError: priced.couponError } : {}),
  };
}

export type StartResult =
  | { kind: "paid" }
  | { kind: "error"; message: string }
  | { kind: "redirect"; url: string }
  | {
      kind: "razorpay";
      keyId: string;
      orderId: string;
      amount: number;
      currency: string;
      name: string;
      description: string;
      script: string;
    };

type AttemptRow = Database["public"]["Tables"]["payment_attempts"]["Row"];

async function openAttempt(
  admin: Client,
  p: Payable,
  priced: Priced,
  maxAgeMs: number,
): Promise<AttemptRow | null> {
  let q = admin
    .from("payment_attempts")
    .select("*")
    .eq("response_id", p.responseId)
    .eq("provider", p.config.provider)
    .eq("status", "pending")
    .eq("amount", priced.quote.total)
    .gte("created_at", new Date(Date.now() - maxAgeMs).toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  q = priced.couponId ? q.eq("coupon_id", priced.couponId) : q.is("coupon_id", null);
  const { data } = await q;
  return data?.[0] ?? null;
}

/** The response's payment, as pending, unless it's already paid. */
async function markPending(admin: Client, p: Payable, attempt: AttemptRow) {
  if (p.paymentStatus === "paid" || p.paymentStatus === "refunded") return;
  await admin.from("payments").upsert(
    {
      response_id: p.responseId,
      form_id: p.formId,
      amount: attempt.amount,
      currency: attempt.currency,
      status: "pending",
      provider: attempt.provider,
      subtotal: attempt.subtotal,
      discount: attempt.discount,
      coupon_id: attempt.coupon_id,
      coupon_code: attempt.coupon_code,
      ...(attempt.provider === "stripe"
        ? { checkout_session_id: attempt.provider_ref }
        : {}),
      livemode: attempt.livemode,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "response_id" },
  );
  // A race with a confirmation is refused by the database's guard.
}

/**
 * Starts (or resumes) paying for a response. Razorpay: an order for the
 * in-form Checkout. Stripe: a Checkout page to send the respondent to.
 * Free after a coupon: recorded as paid at once.
 */
export async function startPayment(
  admin: Client,
  responseId: string,
  options: {
    couponCode?: string | null;
    origin: string;
    slug: string;
    fetch?: typeof fetch;
  },
): Promise<StartResult> {
  const fetchImpl = options.fetch ?? fetch;
  const loaded = await loadPayable(admin, responseId);
  if (!loaded) return { kind: "error", message: "There's nothing to pay." };
  if (!loaded.ok) return { kind: "error", message: loaded.message };
  const p = loaded.payable;
  if (p.paymentStatus === "paid" || p.paymentStatus === "refunded")
    return { kind: "paid" };
  const priced = await price(admin, p, options.couponCode, Date.now());
  if (priced.couponError) return { kind: "error", message: priced.couponError };
  const { quote } = priced;

  const attempt = {
    response_id: responseId,
    form_id: p.formId,
    subtotal: quote.subtotal,
    discount: quote.discount,
    amount: quote.total,
    currency: quote.currency,
    coupon_id: priced.couponId,
    coupon_code: quote.coupon?.code ?? null,
  };

  if (quote.total === 0) {
    const ref = `coupon:${responseId}`;
    await admin
      .from("payment_attempts")
      .upsert(
        { ...attempt, provider: "coupon", provider_ref: ref },
        { onConflict: "provider_ref", ignoreDuplicates: true },
      );
    await confirmAttemptPaid(admin, ref, null);
    return { kind: "paid" };
  }

  if (p.config.provider === "razorpay") {
    const secrets = await loadCredential<RazorpaySecrets>(
      admin,
      p.workspaceId,
      "razorpay",
    );
    if (!secrets)
      return { kind: "error", message: "Payments aren't set up for this form." };
    let row = await openAttempt(admin, p, priced, 7 * 86_400_000);
    if (!row) {
      const order = await createRazorpayOrder(
        secrets,
        { amount: quote.total, responseId, formId: p.formId },
        fetchImpl,
      );
      if (!order.ok) {
        return {
          kind: "error",
          message: "Razorpay didn't start the payment. Please try again.",
        };
      }
      const { data, error } = await admin
        .from("payment_attempts")
        .insert({
          ...attempt,
          provider: "razorpay",
          provider_ref: order.data.id,
          livemode: !isTestKey(secrets.keyId),
        })
        .select("*")
        .single();
      if (error || !data) throw error ?? new Error("attempt not saved");
      row = data;
    }
    await markPending(admin, p, row);
    return {
      kind: "razorpay",
      keyId: secrets.keyId,
      orderId: row.provider_ref,
      amount: row.amount,
      currency: "INR",
      name: p.formTitle.slice(0, 100),
      description: p.config.description,
      script: razorpayCheckoutScript(),
    };
  }

  const secrets = await loadCredential<StripeSecrets>(admin, p.workspaceId, "stripe");
  if (!secrets)
    return { kind: "error", message: "Payments aren't set up for this form." };
  // A Checkout Session stays open for 24 hours: reuse one for the same
  // amount rather than letting two be paid.
  const open = await openAttempt(admin, p, priced, 23 * 3_600_000);
  if (open?.checkout_url) {
    await markPending(admin, p, open);
    return { kind: "redirect", url: open.checkout_url };
  }
  const back = `${options.origin}/f/${options.slug}/payment`;
  const session = await createCheckout(
    admin,
    {
      workspaceId: p.workspaceId,
      formId: p.formId,
      responseId,
      currency: quote.currency,
      description: p.config.description,
      amountMinor: quote.total,
      successUrl: `${back}?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${back}?response=${responseId}&canceled=1`,
    },
    fetchImpl,
  );
  if (!session.ok) return { kind: "error", message: session.message };
  const { data: row, error } = await admin
    .from("payment_attempts")
    .insert({
      ...attempt,
      provider: "stripe",
      provider_ref: session.id,
      checkout_url: session.url,
      livemode: session.livemode,
    })
    .select("*")
    .single();
  if (error || !row) throw error ?? new Error("attempt not saved");
  // Older open sessions for this response are closed, so only one can
  // be paid. Best effort: a late payment on one is caught as a duplicate.
  const { data: older } = await admin
    .from("payment_attempts")
    .select("provider_ref")
    .eq("response_id", responseId)
    .eq("provider", "stripe")
    .eq("status", "pending")
    .neq("id", row.id);
  for (const o of older ?? []) {
    if (await expireCheckout(secrets, o.provider_ref, fetchImpl)) {
      await markAttemptFailed(
        admin,
        o.provider_ref,
        "expired",
        "Replaced by a newer payment",
      );
    }
  }
  await markPending(admin, p, row);
  return { kind: "redirect", url: session.url };
}

/**
 * Records an attempt as paid, after the caller verified it with the
 * provider. Then issues documents that wait for payment (receipts) and,
 * for a second payment of an already-paid response, flags it on the
 * timeline. Safe to call again for the same attempt.
 */
export async function confirmAttemptPaid(
  admin: Client,
  providerRef: string,
  providerPaymentId: string | null,
): Promise<"paid" | "already" | "duplicate" | "not_found"> {
  const { data, error } = await admin.rpc("record_payment_paid", {
    p_provider_ref: providerRef,
    p_provider_payment_id: providerPaymentId,
  });
  if (error) throw error;
  const outcome = (data ?? "not_found") as "paid" | "already" | "duplicate" | "not_found";
  if (outcome === "paid" || outcome === "duplicate") {
    const { data: attempt } = await admin
      .from("payment_attempts")
      .select("response_id, amount, currency, provider")
      .eq("provider_ref", providerRef)
      .single();
    if (attempt && outcome === "paid") {
      // Receipts wait for payment; confidential forms (F-30) issue none.
      const { data: form } = await admin
        .from("payment_attempts")
        .select("forms!inner(confidential)")
        .eq("provider_ref", providerRef)
        .single();
      if (!(form?.forms as { confidential: unknown } | undefined)?.confidential) {
        await issueDocumentsForResponse(admin, attempt.response_id);
      }
    }
    if (attempt && outcome === "duplicate") {
      await logResponseEvent(admin, {
        responseId: attempt.response_id,
        kind: "payment",
        outcome: "failed",
        detail: {
          reason: `A second payment of ${formatAmount(attempt.amount, attempt.currency)} was received for an already-paid response. Refund it in your ${attempt.provider === "razorpay" ? "Razorpay" : "Stripe"} dashboard.`,
          payment: providerPaymentId,
        },
      });
    }
  }
  return outcome;
}

/** A failed or expired attempt. The response's payment shows it unless
 * it's paid, or another attempt is still open. */
export async function markAttemptFailed(
  admin: Client,
  providerRef: string,
  status: "failed" | "expired",
  error?: string | null,
): Promise<void> {
  const { data: attempt } = await admin
    .from("payment_attempts")
    .update({
      status,
      error: error?.slice(0, 300) ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("provider_ref", providerRef)
    .in("status", ["pending", "failed"])
    .select("response_id")
    .maybeSingle();
  if (!attempt) return;
  const { count } = await admin
    .from("payment_attempts")
    .select("id", { count: "exact", head: true })
    .eq("response_id", attempt.response_id)
    .eq("status", "pending");
  if (count) return;
  await admin
    .from("payments")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("response_id", attempt.response_id)
    .eq("status", "pending");
}

/**
 * A refund made in the provider's dashboard (product owner: refunds are
 * recorded, not issued, here). `refundedTotal` is everything refunded on
 * that payment so far. Fully refunded → `refunded`; partly → still paid,
 * with the refunded amount.
 */
export async function recordRefund(
  admin: Client,
  provider: PaymentProvider,
  providerPaymentId: string,
  refundedTotal: number,
): Promise<"updated" | "ignored"> {
  const { data: attempt } = await admin
    .from("payment_attempts")
    .select("response_id, amount, currency, status")
    .eq("provider", provider)
    .eq("provider_payment_id", providerPaymentId)
    .maybeSingle();
  if (!attempt || attempt.status !== "paid") return "ignored";
  const { data: payment } = await admin
    .from("payments")
    .select("amount, refunded_amount, provider_payment_id, currency")
    .eq("response_id", attempt.response_id)
    .maybeSingle();
  const money = (m: number) => formatAmount(m, attempt.currency);
  if (!payment || payment.provider_payment_id !== providerPaymentId) {
    // A duplicate payment being refunded: note it, nothing else changes.
    await logResponseEvent(admin, {
      responseId: attempt.response_id,
      kind: "payment",
      outcome: "ok",
      detail: { reason: `Duplicate payment refunded (${money(refundedTotal)})` },
    });
    return "updated";
  }
  if (refundedTotal <= payment.refunded_amount) return "ignored";
  const total = Math.min(refundedTotal, payment.amount);
  await admin
    .from("payments")
    .update({
      refunded_amount: total,
      status: total >= payment.amount ? "refunded" : "paid",
      updated_at: new Date().toISOString(),
    })
    .eq("response_id", attempt.response_id);
  await logResponseEvent(admin, {
    responseId: attempt.response_id,
    kind: "payment",
    outcome: "ok",
    detail: {
      reason:
        total >= payment.amount
          ? `Refunded in full (${money(total)})`
          : `Partly refunded: ${money(total)} of ${money(payment.amount)}`,
    },
  });
  return "updated";
}
