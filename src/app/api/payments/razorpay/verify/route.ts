import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyRazorpayCheckout } from "@/domains/payments/razorpay-events";
import { apiError } from "../../../responses/shared";
import { readPaymentRequest } from "../../shared";

const Body = z.object({
  responseId: z.string().uuid(),
  orderId: z.string().regex(/^order_[A-Za-z0-9]{6,40}$/),
  paymentId: z.string().regex(/^pay_[A-Za-z0-9]{6,40}$/),
  signature: z.string().regex(/^[0-9a-f]{64}$/),
});

/**
 * What Razorpay Checkout handed the respondent's browser after paying
 * (F-35). The browser's word proves nothing: the signature is checked
 * with the key secret and the payment is looked up with Razorpay before
 * the response counts as paid. The signed webhook records the same even
 * if this never arrives.
 */
export async function POST(request: NextRequest) {
  const read = await readPaymentRequest(request, Body, "pay-verify");
  if (!read.ok) return read.response;
  const status = await verifyRazorpayCheckout(createAdminClient(), read.data);
  if (status === "invalid")
    return apiError("invalid_payment", "That payment couldn't be confirmed.", 400);
  return NextResponse.json({ status });
}
