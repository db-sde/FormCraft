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

/** Refreshes the Supabase session cookie when it's due and redirects
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

  const path = request.nextUrl.pathname;

  const isProtected = PROTECTED_PREFIXES.some((p) => path.startsWith(p));
  const isAuthPage = AUTH_PAGES.includes(path);

  // Everywhere but the sign-in pages, the session token is checked here
  // without a round trip to Supabase when it can be (getClaims verifies
  // the signature locally for asymmetric keys, and asks Supabase
  // otherwise). That's enough for a redirect: the page itself still
  // asks Supabase who this is (requireUser). The sign-in pages do ask,
  // because a token that still verifies but whose session was revoked
  // would otherwise bounce between /login and /dashboard.
  let signedIn: boolean;
  if (isAuthPage) {
    signedIn = Boolean((await supabase.auth.getUser()).data.user);
  } else {
    const { data: verified, error } = await supabase.auth.getClaims();
    signedIn = verified
      ? true
      : error
        ? Boolean((await supabase.auth.getUser()).data.user)
        : false;
  }
  const data = { user: signedIn };

  if (isProtected && !data.user) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", path);
    return NextResponse.redirect(redirectUrl);
  }

  if (isAuthPage && data.user) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Signed in with a password but not yet the second factor (P3.13).
  if (isProtected && data.user) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      const redirectUrl = new URL("/two-factor", request.url);
      redirectUrl.searchParams.set("next", path);
      return NextResponse.redirect(redirectUrl);
    }
  }

  return response;
}
