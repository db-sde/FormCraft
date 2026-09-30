import { NextResponse, type NextRequest } from "next/server";

/**
 * Guards scheduled-job routes with the shared CRON_SECRET bearer token
 * (Vercel Cron sends it automatically as `Authorization: Bearer …`).
 * Returns an error response to send, or null when the call is allowed.
 */
export function rejectUnlessCron(request: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: { code: "not_configured", message: "CRON_SECRET is not set." } },
      { status: 503 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Unauthorized." } },
      { status: 401 },
    );
  }
  return null;
}
