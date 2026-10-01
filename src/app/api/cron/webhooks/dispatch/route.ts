import { NextResponse, type NextRequest } from "next/server";
import {
  dispatchDueDeliveries,
  recoverMissingWebhookDeliveries,
} from "@/domains/webhooks";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectUnlessCron } from "@/lib/http/cron-auth";

/**
 * Processes due webhook redeliveries (retries whose backoff window has
 * elapsed). There's no long-running worker in this deployment model,
 * so an external scheduler must call this periodically — e.g. Vercel
 * Cron (`vercel.json` crons entry) hitting this path every few
 * minutes, or a `pg_cron`/`curl` job pointed at it in any other host.
 * Most deliveries succeed on the immediate attempt made right when a
 * response completes (see /api/responses/[id]/complete); this sweep
 * only exists to pick up the ones that didn't.
 *
 * Protected by a shared secret (CRON_SECRET) rather than a user
 * session — nothing about triggering a retry sweep should be
 * reachable by an anonymous caller, since it fans out real HTTP
 * requests to creator-configured URLs.
 */
async function run(request: NextRequest) {
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;
  const admin = createAdminClient();
  // Create anything a failed post-submit callback missed, then send.
  const { recovered } = await recoverMissingWebhookDeliveries(admin);
  const result = await dispatchDueDeliveries(admin);
  return NextResponse.json({ ...result, recovered });
}

// GET for Vercel Cron (vercel.json), POST for other schedulers.
export const GET = run;
export const POST = run;
