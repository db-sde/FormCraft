import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { startPayment } from "@/domains/payments/flow";
import { apiError } from "../../responses/shared";
import { PaymentBody, readPaymentRequest, requestOrigin } from "../shared";

/**
 * Starts paying for a completed response (F-22/F-35): a Razorpay order
 * for the in-form Checkout, a Stripe Checkout page to go to, or "paid"
 * (already paid, or free with the coupon). An open attempt for the same
 * amount is reused; a paid response is never charged again.
 */
export async function POST(request: NextRequest) {
  const read = await readPaymentRequest(request, PaymentBody, "pay-start");
  if (!read.ok) return read.response;
  const admin = createAdminClient();
  const { data: response } = await admin
    .from("responses")
    .select("forms!inner(slug)")
    .eq("id", read.data.responseId)
    .maybeSingle();
  const slug = (response?.forms as { slug: string } | undefined)?.slug;
  if (!slug) return apiError("not_found", "There's nothing to pay.", 404);
  const result = await startPayment(admin, read.data.responseId, {
    couponCode: read.data.coupon,
    origin: requestOrigin(request),
    slug,
  });
  if (result.kind === "error") return apiError("not_payable", result.message, 422);
  return NextResponse.json(result);
}
