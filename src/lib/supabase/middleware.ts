import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";
import { supabaseEnv } from "./env";

const PROTECTED_PREFIXES = ["/dashboard", "/forms"];
const AUTH_PREFIXES = ["/login", "/signup", "/forgot-password", "/reset-password"];

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
  const isAuthPage = AUTH_PREFIXES.some((p) => path.startsWith(p));

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
