import { NextResponse, type NextRequest } from "next/server";
import { dispatchDueDeliveries } from "@/domains/webhooks";
import { createAdminClient } from "@/lib/supabase/admin";

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
export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: { code: "not_configured", message: "CRON_SECRET is not set." } },
      { status: 503 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Unauthorized." } },
      { status: 401 },
    );
  }

  const admin = createAdminClient();
  const result = await dispatchDueDeliveries(admin);
  return NextResponse.json(result);
}
