import { NextResponse, type NextRequest } from "next/server";
import { purgeExpiredUnfinishedResponses } from "@/domains/responses";
import { pruneRateLimits } from "@/domains/abuse";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectUnlessCron } from "@/lib/http/cron-auth";

/**
 * Daily sweep deleting unfinished responses past each form's retention
 * period (Form settings → "Delete unfinished responses after…").
 * Protected by CRON_SECRET; GET for Vercel Cron, POST for other
 * schedulers.
 */
async function run(request: NextRequest) {
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;
  const admin = createAdminClient();
  const result = await purgeExpiredUnfinishedResponses(admin);
  await pruneRateLimits(admin);
  return NextResponse.json(result);
}

export const GET = run;
export const POST = run;
