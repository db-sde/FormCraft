/**
 * FormCraft's own billing accounts (not a workspace's payment
 * connections): Stripe for US dollars, Razorpay for rupees. Each is on
 * only when its keys are set; with neither, owners send an upgrade
 * request instead (Settings → Plan).
 */
export type BillingProvider = "stripe" | "razorpay";
export type BillingInterval = "month" | "year";

export function stripeBilling(): { secretKey: string; webhookSecret: string } | null {
  const secretKey = process.env.STRIPE_BILLING_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_BILLING_WEBHOOK_SECRET;
  return secretKey && webhookSecret ? { secretKey, webhookSecret } : null;
}

export function razorpayBilling(): {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
} | null {
  const keyId = process.env.RAZORPAY_BILLING_KEY_ID;
  const keySecret = process.env.RAZORPAY_BILLING_KEY_SECRET;
  const webhookSecret = process.env.RAZORPAY_BILLING_WEBHOOK_SECRET;
  return keyId && keySecret && webhookSecret ? { keyId, keySecret, webhookSecret } : null;
}

export function billingProviders(): BillingProvider[] {
  return [
    ...(stripeBilling() ? (["stripe"] as const) : []),
    ...(razorpayBilling() ? (["razorpay"] as const) : []),
  ];
}

/** What one billing period costs, in the currency's minor unit: the
 * monthly price, or twelve months at the yearly per-month price. */
export function periodAmountMinor(
  price: { monthly: number; annual: number },
  interval: BillingInterval,
): number {
  return Math.round((interval === "month" ? price.monthly : price.annual * 12) * 100);
}
