import { NextResponse, type NextRequest } from "next/server";
import {
  purgeDeletedForms,
  purgeExpiredCompletedResponses,
  purgeExpiredUnfinishedResponses,
} from "@/domains/responses";
import { pruneRateLimits } from "@/domains/abuse";
import { purgeStaleProfiles } from "@/domains/responses/profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectUnlessCron } from "@/lib/http/cron-auth";

// A batch of background work: bounded explicitly (seconds).
export const maxDuration = 60;

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
  // Finished background work past its keep period (migration 56).
  const { data: operational } = await admin.rpc("prune_operational_data", {});
  // Analytics events past 90 days become daily counts (migration 59).
  let analyticsFolded = 0;
  for (let i = 0; i < 20; i += 1) {
    const { data: folded } = await admin.rpc("rollup_analytics_events", {});
    analyticsFolded += folded ?? 0;
    if (!folded) break;
  }
  const profilesDeleted = await purgeStaleProfiles(admin);
  return NextResponse.json({
    ...expired,
    completedDeleted: completed.deleted,
    ...forms,
    profilesDeleted,
    operational,
    analyticsFolded,
  });
}

export const GET = run;
export const POST = run;
