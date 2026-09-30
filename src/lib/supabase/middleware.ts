import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";
import { supabaseEnv } from "./env";

const PROTECTED_PREFIXES = ["/dashboard", "/forms", "/leads", "/templates", "/settings"];
// Exact paths, not prefixes: `/signup` and `/forgot-password` each have
// a "check your email" sub-page (`/signup/check-email`,
// `/forgot-password/check-email`) that must stay reachable even for an
// already-authenticated visitor (e.g. local/dev Supabase configs that
// auto-confirm on signUp() establish a session immediately, so the
// very user this page is instructing would otherwise never see it — a
// real bug caught by an E2E test, not a hypothetical). A prefix match
// here would swallow those sub-paths into the redirect-away-from-auth
// rule below, which is meant only for the entry forms themselves.
//
// /reset-password is deliberately absent: the recovery link signs the
// user in first (see /auth/confirm), so redirecting signed-in users
// away from it would make resetting a password impossible.
const AUTH_PAGES = ["/login", "/signup", "/forgot-password"];

/** Refreshes the Supabase session cookie on every request and redirects
 * unauthenticated users away from protected routes. This is a UX
 * convenience, not the authorization boundary — every server
 * action/route handler still re-establishes identity itself. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(supabaseEnv.url, supabaseEnv.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;

  const isProtected = PROTECTED_PREFIXES.some((p) => path.startsWith(p));
  const isAuthPage = AUTH_PAGES.includes(path);

  if (isProtected && !data.user) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", path);
    return NextResponse.redirect(redirectUrl);
  }

  if (isAuthPage && data.user) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}
