import { NextResponse, type NextRequest } from "next/server";
import { withApiKey } from "../shared";

/** Checks a key (Zapier's "test connection"): which workspace it's for,
 * what it may do, and the plan's API limits. Any key may ask, whatever
 * its permissions (QA FC15-21). */
export async function GET(request: NextRequest) {
  return withApiKey(request, null, async (caller, admin) => {
    const { data } = await admin
      .from("workspaces")
      .select("id, name")
      .eq("id", caller.workspaceId)
      .single();
    return NextResponse.json({
      workspace: data,
      permissions: caller.scopes,
      limits: {
        per_minute: caller.perMinute,
        burst: caller.burst,
        per_day: caller.perDay,
      },
    });
  });
}
