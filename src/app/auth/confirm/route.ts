import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/http/safe-next-path";
import { createAdminClient } from "@/lib/supabase/admin";
import { joinSsoWorkspace } from "@/domains/identity/sso";
import { audit } from "@/domains/audit";
import { WORKSPACE_COOKIE } from "@/lib/auth/current-workspace";

const OTP_TYPES: EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

/**
 * Landing point for every emailed auth link (signup confirmation,
 * password recovery). Supabase verifies the link, then redirects here
 * with either a PKCE `code` or a `token_hash` + `type`; this exchanges
 * it for a session cookie and continues to `next`.
 *
 * Must be listed in the Supabase project's allowed redirect URLs —
 * otherwise Supabase silently falls back to the Site URL and the link
 * never signs anyone in (see README / supabase/config.toml).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createServerSupabaseClient();
  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type && OTP_TYPES.includes(type)) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  }

  if (ok) {
    const response = NextResponse.redirect(new URL(next, request.url));
    // An SSO sign-in (P3.12) lands in the company's workspace, joining
    // it on the first visit. Never blocks signing in.
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const admin = createAdminClient();
      const joined = user ? await joinSsoWorkspace(admin, user) : null;
      if (user && joined) {
        if (joined.joined) {
          await audit(admin, {
            workspaceId: joined.workspaceId,
            actorId: user.id,
            action: "member.joined",
            target: { type: "user", id: user.id },
            metadata: { via: "sso" },
          });
        }
        response.cookies.set(WORKSPACE_COOKIE, joined.workspaceId, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 60 * 60 * 24 * 365,
        });
      }
    } catch {
      // Signed in either way; they can be invited the usual way.
    }
    return response;
  }

  // A signup link opened in a different browser can't complete the PKCE
  // exchange, but Supabase has still confirmed the email by this point —
  // so the useful next step is signing in, not a dead end.
  const fallback = new URL("/login", request.url);
  fallback.searchParams.set(
    "notice",
    next === "/reset-password" ? "link_invalid" : "confirm_failed",
  );
  return NextResponse.redirect(fallback);
}
