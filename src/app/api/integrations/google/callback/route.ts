import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  exchangeCodeForTokens,
  pkceForFlow,
  OAUTH_STATE_COOKIE,
  saveConnection,
  verifyOAuthState,
} from "@/domains/sheets";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { trackEvent } from "@/lib/analytics/track";

/**
 * Google redirects the respondent's (creator's) browser back here with
 * either `code` (success) or `error` (they declined, or something
 * failed on Google's side). `state` carries the form id set by
 * /api/integrations/google/authorize — re-verified against the
 * caller's own workspace membership here exactly like the authorize
 * step, since `state` is attacker-visible/forgeable and must never be
 * trusted on its own (see oauth.ts's doc comment).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const oauthError = params.get("error");

  const { supabase, workspace, user } = await getCurrentWorkspace();

  // The state must be one this user's browser started (signed, unexpired,
  // matching cookie) — see oauth-state.ts. Anything else is refused
  // before we look at the form or exchange a code.
  const verified = verifyOAuthState(params.get("state"), {
    userId: user.id,
    cookieNonce: request.cookies.get(OAUTH_STATE_COOKIE)?.value,
  });
  const fail = (status: number) => {
    const res = NextResponse.json(
      {
        error: {
          code: "invalid_state",
          message:
            "This connection link is invalid or expired. Start again from the form's Integrations page.",
        },
      },
      { status },
    );
    res.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/api/integrations/google" });
    return res;
  };
  if (!verified.ok) return fail(400);
  const formId = verified.formId;

  const redirectTo = request.nextUrl.clone();
  redirectTo.pathname = `/forms/${formId}/integrations`;
  const done = (search: string) => {
    redirectTo.search = search;
    const res = NextResponse.redirect(redirectTo);
    // Single use: the nonce can't be replayed.
    res.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/api/integrations/google" });
    return res;
  };

  if (oauthError || !code) return done("?sheets_error=declined");

  const { data: form } = await supabase
    .from("forms")
    .select("id")
    .eq("id", formId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!form) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Form not found." } },
      { status: 404 },
    );
  }

  // Two steps, each reported on its own: Google's token exchange, then
  // storing the connection. The log names the step and the error, never
  // the code, the tokens or the client secret.
  const failed = (step: "google" | "save", err: unknown) => {
    const e = err as { name?: string; message?: string; code?: string };
    console.error("sheets_exchange_failed", {
      step,
      formId,
      name: e?.name,
      message: e?.message,
      code: e?.code,
    });
    return done(`?sheets_error=exchange_failed&reason=${step}`);
  };

  let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
  try {
    // verifyOAuthState accepted the flow, so its cookie nonce is present.
    const nonce = request.cookies.get(OAUTH_STATE_COOKIE)?.value ?? "";
    tokens = await exchangeCodeForTokens(code, undefined, pkceForFlow(nonce).verifier);
  } catch (err) {
    return failed("google", err);
  }
  try {
    await saveConnection(supabase, workspace.id, formId, tokens);
  } catch (err) {
    return failed("save", err);
  }
  trackEvent({
    formId,
    eventType: "integration_connected",
    metadata: { provider: "google_sheets" },
  });
  return done("?sheets_connected=1");
}
