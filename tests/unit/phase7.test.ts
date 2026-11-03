import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  amountToCharge,
  chargeable,
  formatAmount,
  PaymentConfig,
  readPaymentConfig,
} from "@/domains/payments/config";
import {
  applyCoupon,
  CouponInput,
  normalizeCode,
  type Coupon,
} from "@/domains/payments/coupons";
import {
  checkoutSignature,
  isRazorpayKeyId,
  paymentSettled,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "@/domains/payments/razorpay";
import { documentApplies, paymentLabel } from "@/domains/documents/issue";
import { buildCsp } from "@/lib/http/csp";
import { buildTimeline } from "@/domains/responses/timeline";

const coupon = (patch: Partial<Coupon> = {}): Coupon => ({
  id: "c1",
  code: "SAVE10",
  kind: "percent",
  percentOff: 10,
  amountOff: null,
  expiresAt: null,
  maxUses: null,
  uses: 0,
  active: true,
  ...patch,
});

describe("payment settings (F-22/F-35)", () => {
  it("keeps old Stripe settings working and takes Razorpay in INR only", () => {
    const legacy = readPaymentConfig({
      amount: 15,
      amountVariableId: null,
      currency: "usd",
      description: "Ticket",
    });
    expect(legacy).toMatchObject({ provider: "stripe", fromOrder: false, amount: 15 });
    const base = {
      amount: 499,
      amountVariableId: null,
      description: "Workshop",
    };
    expect(
      PaymentConfig.safeParse({ ...base, provider: "razorpay", currency: "usd" }).success,
    ).toBe(false);
    expect(
      PaymentConfig.safeParse({ ...base, provider: "razorpay", currency: "inr" }).success,
    ).toBe(true);
    // Exactly one amount source.
    expect(
      PaymentConfig.safeParse({ ...base, fromOrder: true, currency: "inr" }).success,
    ).toBe(false);
  });

  it("charges the product order in its own currency, within each provider's limits", () => {
    const order = PaymentConfig.parse({
      provider: "razorpay",
      amount: null,
      amountVariableId: null,
      fromOrder: true,
      currency: "inr",
      description: "Order",
    });
    expect(amountToCharge(order, {}, { currency: "INR", total: 125_000 })).toEqual({
      ok: true,
      minor: 125_000,
    });
    expect(amountToCharge(order, {}, { currency: "USD", total: 5000 }).ok).toBe(false);
    expect(amountToCharge(order, {}, null).ok).toBe(false);
    expect(chargeable("razorpay", 99)).toBe(false);
    expect(chargeable("razorpay", 100)).toBe(true);
    expect(chargeable("stripe", 50)).toBe(true);
    expect(formatAmount(49900, "inr")).toBe("₹499.00");
  });
});

describe("coupons (F-22)", () => {
  it("takes a percentage or an amount off, never more than the total", () => {
    expect(applyCoupon(coupon(), 49_900)).toEqual({
      ok: true,
      discount: 4990,
      total: 44_910,
    });
    expect(
      applyCoupon(coupon({ kind: "amount", percentOff: null, amountOff: 10_000 }), 5000),
    ).toEqual({ ok: true, discount: 5000, total: 0 });
    expect(applyCoupon(coupon({ percentOff: 100 }), 999)).toEqual({
      ok: true,
      discount: 999,
      total: 0,
    });
  });

  it("refuses unknown, switched-off, expired and used-up codes", () => {
    const now = Date.parse("2026-11-03T10:00:00Z");
    expect(applyCoupon(null, 1000, now)).toMatchObject({ ok: false });
    expect(applyCoupon(coupon({ active: false }), 1000, now)).toMatchObject({
      ok: false,
    });
    expect(
      applyCoupon(coupon({ expiresAt: "2026-11-03T09:59:59Z" }), 1000, now),
    ).toMatchObject({ ok: false, message: "That code has expired." });
    expect(applyCoupon(coupon({ maxUses: 5, uses: 5 }), 1000, now)).toMatchObject({
      ok: false,
      message: "That code has been used up.",
    });
    expect(applyCoupon(coupon({ maxUses: 5, uses: 4 }), 1000, now).ok).toBe(true);
  });

  it("normalises codes and checks what creators enter", () => {
    expect(normalizeCode(" save10 ")).toBe("SAVE10");
    expect(normalizeCode("no spaces allowed")).toBeNull();
    expect(
      CouponInput.parse({ code: "early-bird", kind: "percent", value: 20 }),
    ).toMatchObject({ code: "EARLY-BIRD", expiresAt: null, maxUses: null, active: true });
    expect(
      CouponInput.safeParse({ code: "X1", kind: "percent", value: 20 }).success,
    ).toBe(false);
    expect(
      CouponInput.safeParse({ code: "HALF", kind: "percent", value: 150 }).success,
    ).toBe(false);
    expect(
      CouponInput.safeParse({ code: "HALF", kind: "amount", value: 150 }).success,
    ).toBe(true);
  });
});

describe("Razorpay signatures (F-35)", () => {
  it("accepts only Checkout's signature for this order and payment", () => {
    const sig = checkoutSignature("order_ABC123", "pay_XYZ789", "secret123");
    expect(sig).toBe(
      createHmac("sha256", "secret123").update("order_ABC123|pay_XYZ789").digest("hex"),
    );
    const input = { orderId: "order_ABC123", paymentId: "pay_XYZ789", signature: sig };
    expect(verifyCheckoutSignature(input, "secret123")).toBe(true);
    expect(
      verifyCheckoutSignature({ ...input, paymentId: "pay_OTHER1" }, "secret123"),
    ).toBe(false);
    expect(verifyCheckoutSignature(input, "other-secret")).toBe(false);
    expect(verifyCheckoutSignature({ ...input, signature: "nope" }, "secret123")).toBe(
      false,
    );
  });

  it("checks webhooks against the raw body", () => {
    const body = JSON.stringify({ event: "payment.captured" });
    const header = createHmac("sha256", "whsec").update(body).digest("hex");
    expect(verifyWebhookSignature(body, header, "whsec")).toBe(true);
    expect(verifyWebhookSignature(`${body} `, header, "whsec")).toBe(false);
    expect(verifyWebhookSignature(body, null, "whsec")).toBe(false);
  });

  it("knows a key id, and that only a captured payment is money received", () => {
    expect(isRazorpayKeyId("rzp_test_1DP5mmOlF5G5ag")).toBe(true);
    expect(isRazorpayKeyId("sk_test_123")).toBe(false);
    expect(paymentSettled({ status: "captured" })).toBe(true);
    expect(paymentSettled({ status: "authorized" })).toBe(false);
  });
});

describe("receipts and status", () => {
  it("issues a receipt only once paid, and never calls a refund paid", () => {
    const ctx = { status: "completed", order: null, endingId: null };
    expect(documentApplies("receipt", {}, { ...ctx, payment: null })).toBe(false);
    expect(
      documentApplies(
        "receipt",
        {},
        {
          ...ctx,
          payment: { status: "pending" } as never,
        },
      ),
    ).toBe(false);
    expect(
      documentApplies("receipt", {}, { ...ctx, payment: { status: "paid" } as never }),
    ).toBe(true);
    expect(paymentLabel({ status: "refunded", refundedAmount: 500 })).toEqual({
      label: "Refunded",
      paid: false,
    });
    expect(paymentLabel({ status: "paid", refundedAmount: 100 })).toEqual({
      label: "Paid (partly refunded)",
      paid: true,
    });
  });

  it("lets Razorpay Checkout run on published forms only", () => {
    const form = buildCsp({
      nonce: "n",
      supabaseUrl: "https://x.supabase.co",
      publicForm: true,
    });
    const app = buildCsp({
      nonce: "n",
      supabaseUrl: "https://x.supabase.co",
      publicForm: false,
    });
    expect(form).toContain("https://checkout.razorpay.com");
    expect(form).toMatch(/frame-src[^;]*https:\/\/api\.razorpay\.com/);
    expect(app).not.toContain("razorpay");
  });

  it("shows each payment attempt on the timeline", () => {
    const entries = buildTimeline({
      response: {
        startedAt: "2026-11-03T10:00:00Z",
        completedAt: "2026-11-03T10:01:00Z",
        status: "completed",
      } as never,
      deliveries: [],
      sheets: [],
      payment: null,
      paymentAttempts: [
        {
          id: "a1",
          provider: "razorpay",
          amount: 44_910,
          currency: "inr",
          couponCode: "SAVE10",
          status: "failed",
          error: "Card declined",
          createdAt: "2026-11-03T10:02:00Z",
          updatedAt: "2026-11-03T10:03:00Z",
        },
        {
          id: "a2",
          provider: "razorpay",
          amount: 44_910,
          currency: "inr",
          couponCode: "SAVE10",
          status: "paid",
          error: null,
          createdAt: "2026-11-03T10:04:00Z",
          updatedAt: "2026-11-03T10:05:00Z",
        },
      ],
      events: [],
    });
    const titles = entries.map((e) => e.title);
    expect(titles).toContain("Payment of ₹449.10 started (Razorpay) with coupon SAVE10");
    expect(titles).toContain("Payment failed");
    expect(titles).toContain("Paid ₹449.10 (Razorpay)");
  });
});
