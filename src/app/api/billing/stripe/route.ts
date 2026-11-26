import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleStripeBillingWebhook } from "@/domains/billing/checkout/stripe";

/** Stripe webhooks for FormCraft's own plans (checkout.session.completed,
 * customer.subscription.*). Signed with STRIPE_BILLING_WEBHOOK_SECRET;
 * each event is applied once. */
export async function POST(request: Request) {
  const body = await request.text();
  try {
    const { status } = await handleStripeBillingWebhook(
      createAdminClient(),
      body,
      request.headers.get("stripe-signature"),
    );
    return new NextResponse(null, { status });
  } catch {
    // Stripe retries a failed delivery.
    return new NextResponse(null, { status: 500 });
  }
}
