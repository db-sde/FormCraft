import { NextResponse, type NextRequest } from "next/server";
import { dispatchDueSheetsSyncs } from "@/domains/sheets";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Processes due Google Sheets row syncs (retries whose backoff window
 * has elapsed) — the Sheets counterpart to
 * /api/cron/webhooks/dispatch, same deployment reasoning (no
 * long-running worker, needs an external scheduler) and the same
 * CRON_SECRET-bearer-token protection rather than a user session.
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
  const result = await dispatchDueSheetsSyncs(admin);
  return NextResponse.json(result);
}
