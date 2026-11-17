import { NextResponse, type NextRequest } from "next/server";
import { reconcilePendingPayments } from "@/domains/payments/reconcile";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectUnlessCron } from "@/lib/http/cron-auth";

// A batch of background work: bounded explicitly (seconds).
export const maxDuration = 60;

/**
 * Payment reconciliation (foundations §5): payments still pending after
 * their provider event should have come are asked about directly. Every
 * 15 minutes from the database scheduler; daily from Vercel Cron.
 * Protected by CRON_SECRET; GET for Vercel Cron, POST for other schedulers.
 */
async function run(request: NextRequest) {
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;
  const summary = await reconcilePendingPayments(createAdminClient());
  return NextResponse.json(summary);
}

export const GET = run;
export const POST = run;
