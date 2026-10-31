import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectUnlessCron } from "@/lib/http/cron-auth";
import { sendDueDigests } from "@/domains/notifications/digest";

/** Daily digests (F-25): each form's previous day in its own time zone,
 * sent once. Protected by CRON_SECRET; GET for Vercel Cron, POST for
 * other schedulers. */
async function run(request: NextRequest) {
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;
  return NextResponse.json(await sendDueDigests(createAdminClient()));
}

export const GET = run;
export const POST = run;
