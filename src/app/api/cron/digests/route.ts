import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectUnlessCron } from "@/lib/http/cron-auth";
import { sendDueDigests } from "@/domains/notifications/digest";
import { sendDeferredSummaries } from "@/domains/notifications/deferred";

// A batch of background work: bounded explicitly (seconds).
export const maxDuration = 60;

/** Daily digests (F-25): each form's previous day in its own time zone,
 * sent once; and the daily summary of owner notifications held back by
 * the email quota. Protected by CRON_SECRET; GET for Vercel Cron, POST
 * for other schedulers. */
async function run(request: NextRequest) {
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;
  const admin = createAdminClient();
  const digests = await sendDueDigests(admin);
  const held = await sendDeferredSummaries(admin);
  return NextResponse.json({ ...digests, heldBackSummaries: held.sent });
}

export const GET = run;
export const POST = run;
