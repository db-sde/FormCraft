import { NextResponse, type NextRequest } from "next/server";
import { getHealthReport } from "@/domains/observability";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectUnlessCron } from "@/lib/http/cron-auth";

/**
 * Is the background machinery alive? Reports retries that are long
 * overdue (the cron sweeps stopped), jobs that gave up, and uploads
 * stuck half-finished. Point an uptime monitor at it with the cron
 * secret: it answers 200 when healthy and 503 when something needs a
 * look, so "the sweeps silently stopped" becomes an alert instead of a
 * creator noticing their spreadsheet hasn't updated in days.
 *
 * Read-only — it changes nothing. Guarded like the other cron routes.
 */
async function run(request: NextRequest) {
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;
  const report = await getHealthReport(createAdminClient());
  return NextResponse.json(report, { status: report.status === "ok" ? 200 : 503 });
}

export const GET = run;
export const POST = run;
