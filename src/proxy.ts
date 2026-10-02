import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { supabaseEnv } from "@/lib/supabase/env";
import { CUSTOM_DOMAIN_HEADER } from "@/lib/http/custom-domain";

/** Hosts that are FormCraft itself (everything else may be a customer's
 * custom domain, P2.2). */
function isAppHost(host: string): boolean {
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
  if (host.endsWith(".vercel.app")) return true;
  const extra = (process.env.APP_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase());
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  try {
    if (appUrl && new URL(appUrl).hostname === host) return true;
  } catch {
    // a malformed setting can't match
  }
  return extra.includes(host);
}

type Resolved = { domainId: string; defaultSlug: string | null } | null;
const cache = new Map<string, { value: Resolved; until: number }>();

/** Verified custom domain → its id and default form (cached briefly; a
 * domain that stops verifying stops routing within a minute). */
async function resolveDomain(host: string): Promise<Resolved> {
  const hit = cache.get(host);
  if (hit && hit.until > Date.now()) return hit.value;
  let value: Resolved = null;
  try {
    const res = await fetch(`${supabaseEnv.url}/rest/v1/rpc/resolve_custom_domain`, {
      method: "POST",
      headers: {
        apikey: supabaseEnv.anonKey,
        Authorization: `Bearer ${supabaseEnv.anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_hostname: host }),
    });
    const rows = res.ok
      ? ((await res.json()) as { domain_id: string; default_slug: string | null }[])
      : [];
    value = rows[0]
      ? { domainId: rows[0].domain_id, defaultSlug: rows[0].default_slug }
      : null;
  } catch {
    value = null;
  }
  cache.set(host, { value, until: Date.now() + (value ? 60_000 : 15_000) });
  return value;
}

const notConnected = () =>
  new NextResponse(
    '<!doctype html><title>Not found</title><p style="font-family:system-ui;padding:2rem">There\'s no form here.</p>',
    { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
  );

/** A request on a customer's domain: their published forms and the
 * respondent API only — never the app (no sign-in on customer domains). */
async function customDomain(request: NextRequest, host: string) {
  const domain = await resolveDomain(host);
  if (!domain) return notConnected();
  const path = request.nextUrl.pathname;
  const headers = new Headers(request.headers);
  headers.set(CUSTOM_DOMAIN_HEADER, domain.domainId);

  if (
    path.startsWith("/_next/") ||
    path.startsWith("/api/responses/") ||
    path === "/favicon.ico"
  ) {
    return NextResponse.next({ request: { headers } });
  }
  // Stripe brings respondents back to /f/<slug>/payment (P2.17).
  const payment = /^\/f\/([a-z0-9][a-z0-9-]{0,80})\/payment\/?$/.exec(path);
  if (payment) {
    const url = request.nextUrl.clone();
    url.pathname = `/f/${payment[1]}/payment`;
    return NextResponse.rewrite(url, { request: { headers } });
  }
  let slug: string | null = null;
  if (path === "/") slug = domain.defaultSlug;
  else {
    const match = /^\/(?:f\/)?([a-z0-9][a-z0-9-]{0,80})\/?$/.exec(path);
    slug = match ? match[1] : null;
  }
  if (!slug) return notConnected();
  const url = request.nextUrl.clone();
  url.pathname = `/f/${slug}`;
  return NextResponse.rewrite(url, { request: { headers } });
}

export async function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (!isAppHost(host)) return customDomain(request, host);

  const path = request.nextUrl.pathname;
  if (path.startsWith("/f/") || path.startsWith("/api/")) {
    // No session work here (as before); just make sure nobody can send
    // the custom-domain header themselves.
    if (!request.headers.has(CUSTOM_DOMAIN_HEADER)) return NextResponse.next();
    const headers = new Headers(request.headers);
    headers.delete(CUSTOM_DOMAIN_HEADER);
    return NextResponse.next({ request: { headers } });
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2)$).*)",
  ],
};
