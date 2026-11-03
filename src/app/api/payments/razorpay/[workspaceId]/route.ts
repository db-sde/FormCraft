import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadCredential } from "@/domains/integrations/credentials";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  verifyWebhookSignature,
  type RazorpaySecrets,
} from "@/domains/payments/razorpay";
import {
  applyRazorpayEvent,
  type RazorpayEvent,
} from "@/domains/payments/razorpay-events";

/**
 * Razorpay → FormCraft (F-35). Each workspace adds this URL (with its id)
 * as a webhook in its own Razorpay dashboard, with the events
 * payment.captured, payment.failed, order.paid and refund.processed.
 * Accepted only with a valid `X-Razorpay-Signature` from that workspace's
 * webhook secret. Duplicates are harmless; Razorpay retries non-2xx.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params;
  if (!z.string().uuid().safeParse(workspaceId).success) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = await request.text();
  if (body.length > 1_000_000)
    return NextResponse.json({ error: "too large" }, { status: 413 });
  const admin = createAdminClient();
  const secrets = await loadCredential<RazorpaySecrets>(admin, workspaceId, "razorpay");
  if (
    !secrets ||
    !verifyWebhookSignature(
      body,
      request.headers.get("x-razorpay-signature"),
      secrets.webhookSecret,
    )
  ) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  let event: RazorpayEvent;
  try {
    event = JSON.parse(body) as RazorpayEvent;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const outcome = await applyRazorpayEvent(admin, workspaceId, event);
  return NextResponse.json({ received: true, outcome });
}
