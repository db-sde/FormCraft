import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay (master spec F-35) on the workspace's own account. Respondents
 * pay in Razorpay's Checkout (cards, UPI, netbanking, wallets — whichever
 * the merchant has activated), so card and UPI details never reach
 * FormCraft. A payment counts only when the server has checked it: the
 * Checkout's signature (HMAC of `order_id|payment_id` with the key
 * secret) and Razorpay's own record of the payment, or a webhook signed
 * with the workspace's webhook secret.
 */

export type RazorpaySecrets = { keyId: string; keySecret: string; webhookSecret: string };

export const RAZORPAY_CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

export const razorpayApi = () =>
  process.env.RAZORPAY_API_BASE ?? "https://api.razorpay.com";
/** The Checkout script respondents load (a stand-in in end-to-end tests). */
export const razorpayCheckoutScript = () =>
  process.env.RAZORPAY_CHECKOUT_SCRIPT ?? RAZORPAY_CHECKOUT_SCRIPT;

export function isRazorpayKeyId(key: string): boolean {
  return /^rzp_(test|live)_[A-Za-z0-9]{8,32}$/.test(key);
}

export function isRazorpaySecret(secret: string): boolean {
  return /^[A-Za-z0-9]{16,64}$/.test(secret);
}

export const isTestKey = (keyId: string) => keyId.startsWith("rzp_test_");

function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function sameHex(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** The signature Checkout hands back after a payment. */
export function checkoutSignature(orderId: string, paymentId: string, keySecret: string) {
  return hmacHex(keySecret, `${orderId}|${paymentId}`);
}

export function verifyCheckoutSignature(
  input: { orderId: string; paymentId: string; signature: string },
  keySecret: string,
): boolean {
  if (!/^[0-9a-f]{64}$/.test(input.signature)) return false;
  return sameHex(
    checkoutSignature(input.orderId, input.paymentId, keySecret),
    input.signature,
  );
}

/** `X-Razorpay-Signature`: HMAC-SHA256 of the raw body. */
export function verifyWebhookSignature(
  body: string,
  header: string | null,
  webhookSecret: string,
): boolean {
  if (!header || !/^[0-9a-f]{64}$/.test(header)) return false;
  return sameHex(hmacHex(webhookSecret, body), header);
}

function auth(secrets: Pick<RazorpaySecrets, "keyId" | "keySecret">) {
  return `Basic ${Buffer.from(`${secrets.keyId}:${secrets.keySecret}`).toString("base64")}`;
}

async function call<T>(
  secrets: Pick<RazorpaySecrets, "keyId" | "keySecret">,
  path: string,
  init: { method?: string; body?: unknown } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  const res = await fetchImpl(`${razorpayApi()}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: auth(secrets),
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res) return { ok: false, status: 0, message: "Razorpay couldn't be reached." };
  const data = (await res.json().catch(() => null)) as
    (T & { error?: { description?: string } }) | null;
  if (!res.ok || !data) {
    return {
      ok: false,
      status: res.status,
      message:
        data?.error?.description?.slice(0, 200) ?? `Razorpay answered ${res.status}.`,
    };
  }
  return { ok: true, data };
}

/** Checks a key pair works (Settings → Connections). */
export async function verifyRazorpayKeys(
  secrets: Pick<RazorpaySecrets, "keyId" | "keySecret">,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const res = await call(secrets, "/v1/orders?count=1", {}, fetchImpl);
  return res.ok;
}

export type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  status: string;
};

/** An order for one attempt to pay; `receipt` ties it to the response. */
export function createRazorpayOrder(
  secrets: RazorpaySecrets,
  input: { amount: number; responseId: string; formId: string },
  fetchImpl: typeof fetch = fetch,
) {
  return call<RazorpayOrder>(
    secrets,
    "/v1/orders",
    {
      method: "POST",
      body: {
        amount: input.amount,
        currency: "INR",
        receipt: input.responseId.replace(/-/g, "").slice(0, 40),
        notes: { response_id: input.responseId, form_id: input.formId },
      },
    },
    fetchImpl,
  );
}

export type RazorpayPayment = {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  amount_refunded?: number;
  error_description?: string | null;
};

export function fetchRazorpayPayment(
  secrets: RazorpaySecrets,
  paymentId: string,
  fetchImpl: typeof fetch = fetch,
) {
  if (!/^pay_[A-Za-z0-9]{6,40}$/.test(paymentId)) {
    return Promise.resolve({
      ok: false as const,
      status: 400,
      message: "Not a payment id.",
    });
  }
  return call<RazorpayPayment>(secrets, `/v1/payments/${paymentId}`, {}, fetchImpl);
}

/** A captured payment is money received. An authorized one isn't yet:
 * the account must capture it (Razorpay's automatic capture setting). */
export function paymentSettled(p: Pick<RazorpayPayment, "status">): boolean {
  return p.status === "captured" || p.status === "refunded";
}
