import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
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

export type StripeSecrets = { secretKey: string; webhookSecret: string };

export function isStripeSecretKey(key: string): boolean {
  return /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/.test(key);
}
export function isStripeWebhookSecret(secret: string): boolean {
  return /^whsec_[A-Za-z0-9]{10,}$/.test(secret);
}

const apiBase = () => process.env.STRIPE_API_BASE ?? "https://api.stripe.com";

function form(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

export type Session = {
  id: string;
  url?: string;
  payment_status?: string;
  status?: string;
  livemode?: boolean;
  payment_intent?: string | null;
  metadata?: Record<string, string>;
};

export const stripeApiBase = apiBase;

/** A Checkout Session for one attempt to pay. The caller records it. */
export async function createCheckout(
  admin: Client,
  input: {
    workspaceId: string;
    formId: string;
    responseId: string;
    currency: string;
    description: string;
    amountMinor: number;
    successUrl: string;
    cancelUrl: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<
  | { ok: true; id: string; url: string; livemode: boolean }
  | { ok: false; message: string }
> {
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
      "line_items[0][price_data][currency]": input.currency,
      "line_items[0][price_data][unit_amount]": String(input.amountMinor),
      "line_items[0][price_data][product_data][name]": input.description,
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
  if (!session.url || !session.id)
    return { ok: false, message: "Stripe didn't start the payment. Please try again." };
  return { ok: true, id: session.id, url: session.url, livemode: !!session.livemode };
}

/** Closes an open Checkout Session so it can't be paid. */
export async function expireCheckout(
  secrets: StripeSecrets,
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return false;
  const res = await fetchImpl(`${apiBase()}/v1/checkout/sessions/${sessionId}/expire`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secrets.secretKey}` },
  }).catch(() => null);
  return Boolean(res?.ok);
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
