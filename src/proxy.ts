import { adminSurfaceEnabled, isAdminPath } from "@/lib/admin/surface";
import { newRequestId, REQUEST_ID_HEADER } from "@/lib/http/request-id";
import {
  isSignedVisitor,
  VISITOR_SIG_COOKIE,
  visitorSignature,
} from "@/domains/experiments/visitor-signature";
import { NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { supabaseEnv } from "@/lib/supabase/env";
import { CUSTOM_DOMAIN_HEADER } from "@/lib/http/custom-domain";
import { API_CSP, buildCsp, newNonce } from "@/lib/http/csp";
import {
  VISITOR_COOKIE,
  VISITOR_ID_PATTERN,
  VISITOR_MAX_AGE_SECONDS,
} from "@/domains/experiments/visitor";

/** A page's Content-Security-Policy with a fresh nonce: set on the
 * request (Next.js reads the nonce from it and adds it to its own
 * scripts; layouts read `x-nonce`) and on the response. */
function pageCsp(
  request: NextRequest,
  publicForm: boolean,
  frameAncestors: string[] | null = null,
  admin = false,
) {
  const nonce = newNonce();
  const policy = buildCsp({
    nonce,
    supabaseUrl: supabaseEnv.url,
    publicForm,
    frameAncestors,
    admin,
    dev: process.env.NODE_ENV === "development",
    https: request.nextUrl.protocol === "https:",
  });
  return { nonce, policy };
}

function withCsp(response: NextResponse, policy: string): NextResponse {
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

/** API responses: data, never framed or loaded as a page, and never
 * kept by a browser or shared cache (exports and responses are private). */
function apiResponse(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store");
  return withCsp(response, API_CSP);
}

/** Gives a public form page's visitor a random id (A/B tests, P3.9), on
 * this request too so the first render can use it. Returns the new id
 * to set on the response, or null when there already is one. */
function ensureVisitor(request: NextRequest, headers: Headers): string | null {
  const existing = request.cookies.get(VISITOR_COOKIE)?.value ?? "";
  if (VISITOR_ID_PATTERN.test(existing)) {
    // Signed already, or signed now (an id from before signatures, kept so
    // the visitor keeps their A/B arm): see visitor-signature.ts.
    return isSignedVisitor(existing, request.cookies.get(VISITOR_SIG_COOKIE)?.value)
      ? null
      : existing;
  }
  const id = crypto.randomUUID();
  const cookie = headers.get("cookie");
  headers.set("cookie", `${cookie ? `${cookie}; ` : ""}${VISITOR_COOKIE}=${id}`);
  return id;
}

function withVisitor(
  response: NextResponse,
  request: NextRequest,
  id: string | null,
): NextResponse {
  if (!id) return response;
  const secure = request.nextUrl.protocol === "https:";
  const options = {
    httpOnly: true,
    path: "/",
    maxAge: VISITOR_MAX_AGE_SECONDS,
    // Embeds load the form in a third-party iframe.
    sameSite: secure ? ("none" as const) : ("lax" as const),
    secure,
  };
  response.cookies.set(VISITOR_COOKIE, id, options);
  response.cookies.set(VISITOR_SIG_COOKIE, visitorSignature(id), options);
  return response;
}

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

/** Headers for an anonymous PostgREST call. A legacy anon key is a JWT
 * and also goes in Authorization; a new `sb_publishable_` key is not a
 * JWT and must travel in `apikey` alone. */
function restHeaders(): Record<string, string> {
  const key = supabaseEnv.anonKey;
  return {
    apikey: key,
    ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}),
    "Content-Type": "application/json",
  };
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
      headers: restHeaders(),
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

const embedCache = new Map<string, { value: string[] | null; until: number }>();

/** The sites a form allows to embed it (null: any), cached for a
 * minute. A lookup that fails allows embedding as before rather than
 * breaking every embed. */
async function embedOrigins(slug: string | null): Promise<string[] | null> {
  if (!slug) return null;
  const hit = embedCache.get(slug);
  if (hit && hit.until > Date.now()) return hit.value;
  let value: string[] | null = null;
  try {
    const res = await fetch(`${supabaseEnv.url}/rest/v1/rpc/form_embed_origins`, {
      method: "POST",
      headers: restHeaders(),
      body: JSON.stringify({ p_slug: slug }),
    });
    const data = res.ok ? ((await res.json()) as unknown) : null;
    value = Array.isArray(data)
      ? data.filter((o): o is string => typeof o === "string")
      : null;
  } catch {
    value = null;
  }
  if (embedCache.size > 5000) embedCache.clear();
  embedCache.set(slug, { value, until: Date.now() + 60_000 });
  return value;
}

const archivedCache = new Map<string, { value: boolean; until: number }>();

/** Whether a form is archived (developer spec item 4), cached for a
 * minute. A failed lookup lets the page decide (it shows the form as
 * unavailable too). */
async function isArchived(slug: string | null): Promise<boolean> {
  if (!slug) return false;
  const hit = archivedCache.get(slug);
  if (hit && hit.until > Date.now()) return hit.value;
  let value = false;
  try {
    const res = await fetch(`${supabaseEnv.url}/rest/v1/rpc/form_is_archived`, {
      method: "POST",
      headers: restHeaders(),
      body: JSON.stringify({ p_slug: slug }),
    });
    value = res.ok ? (await res.json()) === true : false;
  } catch {
    value = false;
  }
  if (archivedCache.size > 5000) archivedCache.clear();
  archivedCache.set(slug, { value, until: Date.now() + 60_000 });
  return value;
}

/** An archived form's link, custom domain, embed and resume links: gone
 * (HTTP 410) and never indexed. Nothing about the form is shown. */
const archivedPage = () =>
  new NextResponse(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>No longer available</title></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#fffaf1;color:#2b2118"><main style="max-width:420px;padding:2rem;text-align:center"><h1 style="font-size:1.6rem;margin:0 0 .5rem">This form is no longer available</h1><p style="margin:0;color:#6b5d50">Its owner has archived it, so it isn\'t taking responses.</p></main></body></html>',
    {
      status: 410,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    },
  );

/** The form a public path is for: /f/<slug>[/…]. */
function slugOf(path: string): string | null {
  return /^\/f\/([a-z0-9][a-z0-9-]{0,80})(?:\/|$)/.exec(path)?.[1] ?? null;
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
    const response = NextResponse.next({ request: { headers } });
    return path.startsWith("/api/") ? apiResponse(response) : response;
  }
  // Stripe brings respondents back to /f/<slug>/payment (P2.17).
  const payment = /^\/f\/([a-z0-9][a-z0-9-]{0,80})\/payment\/?$/.exec(path);
  let slug: string | null = null;
  if (payment) slug = payment[1];
  else if (path === "/") slug = domain.defaultSlug;
  else {
    const match = /^\/(?:f\/)?([a-z0-9][a-z0-9-]{0,80})\/?$/.exec(path);
    slug = match ? match[1] : null;
  }
  if (await isArchived(slug)) return archivedPage();
  const { nonce, policy } = pageCsp(request, true, await embedOrigins(slug));
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  if (payment) {
    const url = request.nextUrl.clone();
    url.pathname = `/f/${payment[1]}/payment`;
    return asFormPage(
      withCsp(NextResponse.rewrite(url, { request: { headers } }), policy),
    );
  }
  if (!slug) return notConnected();
  const url = request.nextUrl.clone();
  url.pathname = `/f/${slug}`;
  const visitor = ensureVisitor(request, headers);
  return asFormPage(
    withCsp(
      withVisitor(NextResponse.rewrite(url, { request: { headers } }), request, visitor),
      policy,
    ),
  );
}

/** No page may use the camera, microphone or location… */
const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), browsing-topics=()";
/** …except a form, for its own video and audio answers (roadmap #21):
 * this site only, and an embedding page must allow it on its iframe too. */
const FORM_PERMISSIONS_POLICY =
  "camera=(self), microphone=(self), geolocation=(), browsing-topics=()";

function asFormPage(response: NextResponse): NextResponse {
  response.headers.set("Permissions-Policy", FORM_PERMISSIONS_POLICY);
  return response;
}

/** Every request gets an id (foundations §1): set here for the server
 * code behind it, and returned to the caller. */
export async function proxy(incoming: NextRequest) {
  const requestId = newRequestId(incoming.headers);
  const headers = new Headers(incoming.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  const request = new NextRequest(incoming, { headers });
  const response = await route(request);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  if (!response.headers.has("Permissions-Policy")) {
    response.headers.set("Permissions-Policy", PERMISSIONS_POLICY);
  }
  return response;
}

async function route(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // The Super Admin portal (docs/super-admin-design.md §3.1): only on the
  // admin deployment, which serves nothing else.
  if (adminSurfaceEnabled()) return adminRoute(request, path);
  if (isAdminPath(path)) return new NextResponse("Not found", { status: 404 });

  // Font library stylesheets and files (public, cached, no session): on
  // the app and on custom domains, where forms load them too.
  if (path.startsWith("/fonts/")) return NextResponse.next();
  const host = (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (!isAppHost(host)) return customDomain(request, host);

  if (path.startsWith("/api/")) {
    // No session work here; just make sure nobody can send the
    // custom-domain header themselves.
    const headers = new Headers(request.headers);
    headers.delete(CUSTOM_DOMAIN_HEADER);
    return apiResponse(NextResponse.next({ request: { headers } }));
  }
  if (path.startsWith("/f/")) {
    if (await isArchived(slugOf(path))) return archivedPage();
    const headers = new Headers(request.headers);
    headers.delete(CUSTOM_DOMAIN_HEADER);
    const { nonce, policy } = pageCsp(request, true, await embedOrigins(slugOf(path)));
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", policy);
    const visitor = ensureVisitor(request, headers);
    return asFormPage(
      withCsp(
        withVisitor(NextResponse.next({ request: { headers } }), request, visitor),
        policy,
      ),
    );
  }
  const { nonce, policy } = pageCsp(request, false);
  const response = await updateSession(request, {
    "x-nonce": nonce,
    "Content-Security-Policy": policy,
  });
  return withCsp(response, policy);
}

/** The admin deployment: the portal, its static files and nothing else.
 * Pages are never cached or indexed. Authorization is not decided here:
 * every page and action asks the database (private.check_staff). */
async function adminRoute(request: NextRequest, path: string) {
  if (!isAdminPath(path)) {
    if (path.startsWith("/api/")) return new NextResponse("Not found", { status: 404 });
    return NextResponse.redirect(new URL("/admin", request.url));
  }
  const { nonce, policy } = pageCsp(request, false, null, true);
  const response = await updateSession(request, {
    "x-nonce": nonce,
    "Content-Security-Policy": policy,
  });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return withCsp(response, policy);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2)$).*)",
  ],
};
