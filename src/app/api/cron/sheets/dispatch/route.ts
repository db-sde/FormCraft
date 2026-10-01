import { NextResponse, type NextRequest } from "next/server";
import { dispatchDueSheetsSyncs, recoverMissingSheetsSyncs } from "@/domains/sheets";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectUnlessCron } from "@/lib/http/cron-auth";

/**
 * Processes due Google Sheets row syncs (retries whose backoff window
 * has elapsed) — the Sheets counterpart to
 * /api/cron/webhooks/dispatch, same deployment reasoning (no
 * long-running worker, needs an external scheduler) and the same
 * CRON_SECRET-bearer-token protection rather than a user session.
 */
async function run(request: NextRequest) {
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;
  const admin = createAdminClient();
  const { recovered } = await recoverMissingSheetsSyncs(admin);
  const result = await dispatchDueSheetsSyncs(admin);
  return NextResponse.json({ ...result, recovered });
}

// GET for Vercel Cron (vercel.json), POST for other schedulers.
export const GET = run;
export const POST = run;
