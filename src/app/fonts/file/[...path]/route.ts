import { NextResponse } from "next/server";

/** A font library file (see /fonts/css), fetched from Google's font host
 * and cached for a year: the paths are versioned, so they never change.
 * Only plain WOFF2 paths are accepted. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const path = (await params).path.join("/");
  if (!/^[a-z0-9]+\/[a-z0-9]+\/v\d+\/[A-Za-z0-9_-]+\.woff2$/.test(path)) {
    return new NextResponse("Not found", { status: 404 });
  }
  try {
    const res = await fetch(`https://fonts.gstatic.com/${path}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok || !res.body) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(res.body, {
      headers: {
        "Content-Type": "font/woff2",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 502 });
  }
}
