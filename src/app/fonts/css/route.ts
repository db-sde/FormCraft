import { NextResponse, type NextRequest } from "next/server";
import { featureEnabled } from "@/domains/flags";
import { findFontFamily } from "@/domains/themes/font-refresh";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A font library family's stylesheet (pricing doc: 1,700+ fonts, every
 * plan). Fetched from Google Fonts on the server and rewritten so the font
 * files come from /fonts/file on FormCraft's own domain: respondents'
 * browsers never contact Google, and the CSP stays 'self'. Only families
 * in the library are served.
 */
export async function GET(request: NextRequest) {
  if (!(await featureEnabled("font_library", null)))
    return new NextResponse("Unknown font", { status: 404 });
  const font = await findFontFamily(
    createAdminClient(),
    request.nextUrl.searchParams.get("family"),
  );
  if (!font) return new NextResponse("Unknown font", { status: 404 });
  // Only the weights asked for (`w=400,600`), of those the family has:
  // the stage loads at most four files (developer spec item 3).
  const asked = (request.nextUrl.searchParams.get("w") ?? "")
    .split(",")
    .map(Number)
    .filter((w) => font.weights.includes(w));
  const weights = asked.length ? [...new Set(asked)].sort() : font.weights;
  const family = encodeURIComponent(font.family).replace(/%20/g, "+");
  const upstream = `https://fonts.googleapis.com/css2?family=${family}:wght@${weights.join(";")}&display=swap`;
  let css: string;
  try {
    const res = await fetch(upstream, {
      // A current browser's agent, so Google answers with WOFF2.
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      },
      next: { revalidate: 60 * 60 * 24 * 7 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return new NextResponse("Font unavailable", { status: 502 });
    css = await res.text();
  } catch {
    return new NextResponse("Font unavailable", { status: 502 });
  }
  // Keep only font-face rules pointing at Google's font host, moved to ours.
  const rewritten = css.replace(
    /url\(https:\/\/fonts\.gstatic\.com\/([A-Za-z0-9/_.-]+\.woff2)\)/g,
    "url(/fonts/file/$1)",
  );
  if (/https?:\/\//.test(rewritten.replace(/\/\*[\s\S]*?\*\//g, ""))) {
    return new NextResponse("Font unavailable", { status: 502 });
  }
  return new NextResponse(rewritten, {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control":
        "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
