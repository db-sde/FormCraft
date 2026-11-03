import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { quotePayment } from "@/domains/payments/flow";
import { apiError } from "../../responses/shared";
import { PaymentBody, readPaymentRequest } from "../shared";

/**
 * What a completed response owes (F-22): the amount the server works out,
 * less a coupon if one is given (checked here; its use is counted only
 * when paid). Public, with the response id.
 */
export async function POST(request: NextRequest) {
  const read = await readPaymentRequest(request, PaymentBody, "pay-quote");
  if (!read.ok) return read.response;
  const quote = await quotePayment(
    createAdminClient(),
    read.data.responseId,
    read.data.coupon,
  );
  if (!quote) return apiError("not_found", "There's nothing to pay.", 404);
  if (!quote.ok) return apiError("not_payable", quote.message, 422);
  return NextResponse.json({
    quote: quote.quote,
    status: quote.status ?? "unpaid",
    ...(quote.couponError ? { couponError: quote.couponError } : {}),
  });
}
