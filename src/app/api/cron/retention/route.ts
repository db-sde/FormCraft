import { NextResponse, type NextRequest } from "next/server";
import {
  purgeDeletedForms,
  purgeExpiredCompletedResponses,
  purgeExpiredUnfinishedResponses,
} from "@/domains/responses";
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
  const expired = await purgeExpiredUnfinishedResponses(admin);
  const completed = await purgeExpiredCompletedResponses(admin);
  const forms = await purgeDeletedForms(admin);
  await pruneRateLimits(admin);
  return NextResponse.json({ ...expired, completedDeleted: completed.deleted, ...forms });
}

export const GET = run;
export const POST = run;
