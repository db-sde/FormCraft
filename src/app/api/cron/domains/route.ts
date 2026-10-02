import { NextResponse, type NextRequest } from "next/server";
import { recheckDomains } from "@/domains/domains";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectUnlessCron } from "@/lib/http/cron-auth";

/**
 * Re-checks every custom domain's DNS (P2.2): a domain whose TXT record
 * was removed goes to "error" and stops being served; pending ones are
 * verified once their record appears. Protected by CRON_SECRET.
 */
async function run(request: NextRequest) {
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;
  return NextResponse.json(await recheckDomains(createAdminClient()));
}

export const GET = run;
export const POST = run;
