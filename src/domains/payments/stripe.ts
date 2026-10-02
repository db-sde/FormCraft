import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { loadCredential } from "@/domains/integrations/credentials";

type Client = SupabaseClient<Database>;

/**
 * Stripe payments (PRD P2.17) on the creator's own Stripe account.
 * Respondents pay on Stripe Checkout, so FormCraft never sees card
 * numbers. The amount is computed here from the form's payment settings
 * and the response (a fixed price, or a calculated variable) — never
 * taken from the browser. A payment's status is only changed by a
 * signed Stripe webhook or by asking Stripe about the session from the
 * server; the respondent's return to the form proves nothing on its own.
 * Answers are saved before payment, so a failed or abandoned payment
 * never loses a response.
 */

export const CURRENCIES = [
  "usd",
  "eur",
  "gbp",
  "inr",
  "cad",
  "aud",
  "jpy",
  "sgd",
  "chf",
] as const;
const ZERO_DECIMAL = new Set(["jpy"]);

export const PaymentConfig = z
  .object({
    amount: z.number().positive().max(1_000_000).nullable(),
    amountVariableId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .nullable(),
    currency: z.enum(CURRENCIES),
    description: z.string().trim().min(1).max(200),
  })
  .refine((c) => (c.amount === null) !== (c.amountVariableId === null), {
    message: "Charge either a fixed amount or a calculated one.",
  });
export type PaymentConfig = z.infer<typeof PaymentConfig>;

export type StripeSecrets = { secretKey: string; webhookSecret: string };

export function isStripeSecretKey(key: string): boolean {
  return /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/.test(key);
}
export function isStripeWebhookSecret(secret: string): boolean {
  return /^whsec_[A-Za-z0-9]{10,}$/.test(secret);
}

/** Smallest currency unit for a response, or why not. */
export function amountToCharge(
  config: PaymentConfig,
  variables: Record<string, unknown>,
): { ok: true; minor: number } | { ok: false; message: string } {
  const major =
    config.amount ??
    (typeof variables[config.amountVariableId ?? ""] === "number"
      ? (variables[config.amountVariableId!] as number)
      : NaN);
  if (!Number.isFinite(major) || major <= 0) {
    return { ok: false, message: "The amount to pay couldn't be worked out." };
  }
  const minor = Math.round(major * (ZERO_DECIMAL.has(config.currency) ? 1 : 100));
  // Stripe's minimum is roughly 50 cents; its maximum is 99,999,999 units.
  if (minor < 50 || minor > 99_999_999) {
    return { ok: false, message: "The amount is outside what can be charged." };
  }
  return { ok: true, minor };
}

const apiBase = () => process.env.STRIPE_API_BASE ?? "https://api.stripe.com";

function form(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

type Session = {
  id: string;
  url?: string;
  payment_status?: string;
  status?: string;
  livemode?: boolean;
  metadata?: Record<string, string>;
};

/** A Checkout Session for a response's payment, recorded as pending. */
export async function createCheckout(
  admin: Client,
  input: {
    workspaceId: string;
    formId: string;
    responseId: string;
    config: PaymentConfig;
    amountMinor: number;
    successUrl: string;
    cancelUrl: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const secrets = await loadCredential<StripeSecrets>(admin, input.workspaceId, "stripe");
  if (!secrets) return { ok: false, message: "Payments aren't set up for this form." };
  const res = await fetchImpl(`${apiBase()}/v1/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secrets.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form({
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": input.config.currency,
      "line_items[0][price_data][unit_amount]": String(input.amountMinor),
      "line_items[0][price_data][product_data][name]": input.config.description,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.responseId,
      "metadata[response_id]": input.responseId,
      "metadata[form_id]": input.formId,
      "payment_intent_data[metadata][response_id]": input.responseId,
    }),
  }).catch(() => null);
  if (!res || !res.ok)
    return { ok: false, message: "Stripe didn't start the payment. Please try again." };
  const session = (await res.json()) as Session;
  if (!session.url)
    return { ok: false, message: "Stripe didn't start the payment. Please try again." };
  const { error } = await admin.from("payments").upsert(
    {
      response_id: input.responseId,
      form_id: input.formId,
      amount: input.amountMinor,
      currency: input.config.currency,
      status: "pending",
      checkout_session_id: session.id,
      livemode: !!session.livemode,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "response_id" },
  );
  if (error) throw error;
  return { ok: true, url: session.url };
}

/** Stripe's `Stripe-Signature` check: HMAC-SHA256 of `${t}.${body}`,
 * within five minutes. */
export function verifyStripeSignature(
  body: string,
  header: string | null,
  secret: string,
  now = Date.now(),
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, ...v] = p.split("=");
      return [k.trim(), v.join("=")];
    }),
  );
  const t = Number(parts.t);
  const signatures = header
    .split(",")
    .filter((p) => p.trim().startsWith("v1="))
    .map((p) => p.trim().slice(3));
  if (!Number.isFinite(t) || signatures.length === 0) return false;
  if (Math.abs(now / 1000 - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return signatures.some(
    (sig) =>
      sig.length === expected.length &&
      timingSafeEqual(Buffer.from(sig), Buffer.from(expected)),
  );
}

const STATUS_FOR_EVENT: Record<string, "paid" | "failed" | "expired" | undefined> = {
  "checkout.session.completed": "paid",
  "checkout.session.async_payment_succeeded": "paid",
  "checkout.session.async_payment_failed": "failed",
  "checkout.session.expired": "expired",
};

/** Applies a verified Stripe event to the payment it's about. A paid
 * payment never goes back. */
export async function applyStripeEvent(
  admin: Client,
  event: { type: string; data: { object: Session } },
): Promise<"updated" | "ignored"> {
  let status = STATUS_FOR_EVENT[event.type];
  const session = event.data.object;
  if (!status || !session?.id) return "ignored";
  // "completed" with a delayed payment method isn't paid yet.
  if (event.type === "checkout.session.completed" && session.payment_status !== "paid") {
    return "ignored";
  }
  const { data: payment } = await admin
    .from("payments")
    .select("response_id, status")
    .eq("checkout_session_id", session.id)
    .maybeSingle();
  if (!payment || payment.status === "paid") return "ignored";
  if (
    session.metadata?.response_id &&
    session.metadata.response_id !== payment.response_id
  ) {
    return "ignored";
  }
  if (status !== "paid" && payment.status !== "pending") status = payment.status as never;
  await admin
    .from("payments")
    .update({
      status,
      paid_at: status === "paid" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("response_id", payment.response_id);
  return "updated";
}

/** Asks Stripe about a session (used when the respondent comes back) and
 * records what Stripe says. */
export async function refreshFromStripe(
  admin: Client,
  workspaceId: string,
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<"paid" | "pending" | "failed" | "expired" | "canceled" | null> {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return null;
  const secrets = await loadCredential<StripeSecrets>(admin, workspaceId, "stripe");
  if (!secrets) return null;
  const res = await fetchImpl(`${apiBase()}/v1/checkout/sessions/${sessionId}`, {
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
  const { data } = await admin
    .from("payments")
    .select("status")
    .eq("checkout_session_id", sessionId)
    .maybeSingle();
  return (data?.status as never) ?? null;
}

export function readPaymentConfig(raw: Json | null): PaymentConfig | null {
  const parsed = PaymentConfig.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
