import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleRazorpayBillingWebhook } from "@/domains/billing/checkout/razorpay";

/** Razorpay webhooks for FormCraft's own plans (subscription.*). Signed
 * with RAZORPAY_BILLING_WEBHOOK_SECRET; each event is applied once. */
export async function POST(request: Request) {
  const body = await request.text();
  try {
    const { status } = await handleRazorpayBillingWebhook(
      createAdminClient(),
      body,
      request.headers.get("x-razorpay-signature"),
      request.headers.get("x-razorpay-event-id"),
    );
    return new NextResponse(null, { status });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
