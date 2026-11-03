import { z } from "zod";

/**
 * Coupons (master spec F-22). Product owner (2026-11-03): codes are per
 * form, take a percentage or an amount off, may expire and may have a
 * usage limit; one coupon per payment, no stacking. A use is counted when
 * the payment is confirmed, never when a code is merely tried. Codes are
 * checked on the server each time a payment starts.
 */

export const CouponInput = z
  .object({
    code: z
      .string()
      .trim()
      .transform((c) => c.toUpperCase())
      .pipe(
        z
          .string()
          .regex(
            /^[A-Z0-9_-]{3,40}$/,
            "Use 3–40 letters, numbers, dashes or underscores.",
          ),
      ),
    kind: z.enum(["percent", "amount"]),
    /** Percent: 1–100. Amount: in major units (₹50, $5). */
    value: z.number().positive(),
    expiresAt: z.string().datetime().nullable().default(null),
    maxUses: z.number().int().positive().max(1_000_000).nullable().default(null),
    active: z.boolean().default(true),
  })
  .refine((c) => c.kind !== "percent" || (Number.isInteger(c.value) && c.value <= 100), {
    message: "A percentage is a whole number from 1 to 100.",
    path: ["value"],
  });
export type CouponInput = z.input<typeof CouponInput>;

export type Coupon = {
  id: string;
  code: string;
  kind: "percent" | "amount";
  percentOff: number | null;
  /** Minor units. */
  amountOff: number | null;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  active: boolean;
};

export function couponFromRow(row: {
  id: string;
  code: string;
  kind: string;
  percent_off: number | null;
  amount_off: number | null;
  expires_at: string | null;
  max_uses: number | null;
  uses: number;
  active: boolean;
}): Coupon {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind === "percent" ? "percent" : "amount",
    percentOff: row.percent_off,
    amountOff: row.amount_off,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    uses: row.uses,
    active: row.active,
  };
}

/** What a respondent typed, as a code we'd store ("save10 " → "SAVE10"),
 * or null when it can't be one. */
export function normalizeCode(input: string | null | undefined): string | null {
  const code = (input ?? "").trim().toUpperCase();
  return /^[A-Z0-9_-]{3,40}$/.test(code) ? code : null;
}

/**
 * The discount a coupon gives on a subtotal, or why it can't be used.
 * Never more than the subtotal; a total of zero means nothing to pay.
 * Messages don't say whether a code exists for another form.
 */
export function applyCoupon(
  coupon: Coupon | null,
  subtotal: number,
  now = Date.now(),
): { ok: true; discount: number; total: number } | { ok: false; message: string } {
  if (!coupon || !coupon.active) {
    return { ok: false, message: "That code isn't valid." };
  }
  if (coupon.expiresAt && Date.parse(coupon.expiresAt) <= now) {
    return { ok: false, message: "That code has expired." };
  }
  if (coupon.maxUses !== null && coupon.uses >= coupon.maxUses) {
    return { ok: false, message: "That code has been used up." };
  }
  const raw =
    coupon.kind === "percent"
      ? Math.round((subtotal * (coupon.percentOff ?? 0)) / 100)
      : (coupon.amountOff ?? 0);
  const discount = Math.min(subtotal, Math.max(0, raw));
  return { ok: true, discount, total: subtotal - discount };
}

export function describeCoupon(
  coupon: Coupon,
  format: (minor: number) => string,
): string {
  return coupon.kind === "percent"
    ? `${coupon.percentOff}% off`
    : `${format(coupon.amountOff ?? 0)} off`;
}
