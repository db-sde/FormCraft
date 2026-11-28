import { NextResponse, type NextRequest } from "next/server";

/**
 * Crawlers and some browsers ask for /favicon.ico whatever the page
 * links to (QA FC15-11). They're sent to the generated icon (/icon,
 * from icon.tsx), which every browser accepts as a PNG.
 */
export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/icon", request.url), {
    status: 308,
    headers: { "Cache-Control": "public, max-age=86400" },
  });
}
