import { z } from "zod";
import type { Json } from "@/lib/supabase/database.types";

/**
 * A form's payment settings (P2.17, master spec F-22/F-35): which
 * provider (the workspace's own Stripe or Razorpay account), what's
 * charged — a fixed price, a calculated variable, or the order total from
 * its product blocks — and the currency. The amount is always worked out
 * on the server from the response; never taken from the browser.
 * Razorpay takes INR only (product owner, 2026-11-03).
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
export type Currency = (typeof CURRENCIES)[number];
const ZERO_DECIMAL = new Set(["jpy"]);

export const PAYMENT_PROVIDERS = ["stripe", "razorpay"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const PROVIDER_LABEL: Record<PaymentProvider | "coupon", string> = {
  stripe: "Stripe",
  razorpay: "Razorpay",
  coupon: "Coupon",
};

/** The smallest charge each provider takes, in minor units: Stripe about
 * 50 cents, Razorpay ₹1. */
const MINIMUM: Record<PaymentProvider, number> = { stripe: 50, razorpay: 100 };
const MAXIMUM = 99_999_999;

export const PaymentConfig = z
  .object({
    provider: z.enum(PAYMENT_PROVIDERS).default("stripe"),
    amount: z.number().positive().max(1_000_000).nullable(),
    amountVariableId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .nullable(),
    /** Charge the order total from the form's product blocks (F-04). */
    fromOrder: z.boolean().default(false),
    currency: z.enum(CURRENCIES),
    description: z.string().trim().min(1).max(200),
  })
  .refine(
    (c) =>
      [c.amount !== null, c.amountVariableId !== null, c.fromOrder].filter(Boolean)
        .length === 1,
    { message: "Charge either a fixed amount, a calculated one, or the order total." },
  )
  .refine((c) => c.provider !== "razorpay" || c.currency === "inr", {
    message: "Razorpay payments are in INR.",
  });
export type PaymentConfig = z.infer<typeof PaymentConfig>;

export function readPaymentConfig(raw: Json | null): PaymentConfig | null {
  const parsed = PaymentConfig.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Whether a form charges for the order from its Products questions:
 * a payment set to charge the order total, on a plan with payments. */
export function chargesOrders(raw: Json | null, paymentsAllowed: boolean): boolean {
  return paymentsAllowed && Boolean(readPaymentConfig(raw)?.fromOrder);
}

export function minorUnits(currency: string): number {
  return ZERO_DECIMAL.has(currency.toLowerCase()) ? 1 : 100;
}

/** Whether a provider can charge this many minor units. */
export function chargeable(provider: PaymentProvider, minor: number): boolean {
  return Number.isInteger(minor) && minor >= MINIMUM[provider] && minor <= MAXIMUM;
}

/** What the response owes before any coupon, in minor units, or why
 * not. `order` is the response's saved product order. */
export function amountToCharge(
  config: PaymentConfig,
  variables: Record<string, unknown>,
  order: { currency: string; total: number } | null = null,
): { ok: true; minor: number } | { ok: false; message: string } {
  let minor: number;
  if (config.fromOrder) {
    if (!order || order.total <= 0) {
      return { ok: false, message: "Nothing was ordered, so there's nothing to pay." };
    }
    if (order.currency.toLowerCase() !== config.currency) {
      return { ok: false, message: "The order's currency doesn't match the payment's." };
    }
    minor = order.total;
  } else {
    const major =
      config.amount ??
      (typeof variables[config.amountVariableId ?? ""] === "number"
        ? (variables[config.amountVariableId!] as number)
        : NaN);
    if (!Number.isFinite(major) || major <= 0) {
      return { ok: false, message: "The amount to pay couldn't be worked out." };
    }
    minor = Math.round(major * minorUnits(config.currency));
  }
  if (!chargeable(config.provider, minor)) {
    return { ok: false, message: "The amount is outside what can be charged." };
  }
  return { ok: true, minor };
}

export function formatAmount(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(minor / minorUnits(currency));
  } catch {
    return `${(minor / minorUnits(currency)).toFixed(2)} ${currency.toUpperCase()}`;
  }
}
