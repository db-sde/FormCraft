import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  applyStripeEvent,
  verifyStripeSignature,
  type StripeSecrets,
} from "@/domains/payments";
import { loadCredential } from "@/domains/integrations/credentials";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Stripe → FormCraft (P2.17). Each workspace adds this URL (with its id)
 * as a webhook endpoint in its own Stripe account; the event is accepted
 * only with a valid signature from that workspace's signing secret.
 * This — not the respondent's browser — is what marks a payment paid.
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
  const secrets = await loadCredential<StripeSecrets>(admin, workspaceId, "stripe");
  if (
    !secrets ||
    !verifyStripeSignature(
      body,
      request.headers.get("stripe-signature"),
      secrets.webhookSecret,
    )
  ) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  let event: { type: string; data: { object: { id: string } } };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const outcome = await applyStripeEvent(admin, event as never);
  return NextResponse.json({ received: true, outcome });
}
