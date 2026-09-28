import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { exchangeCodeForTokens, saveConnection } from "@/domains/sheets";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";

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
  const formId = params.get("state");
  const code = params.get("code");
  const oauthError = params.get("error");

  if (!formId) {
    return NextResponse.json(
      { error: { code: "invalid_body", message: "Missing state." } },
      { status: 400 },
    );
  }

  const redirectTo = request.nextUrl.clone();
  redirectTo.pathname = `/forms/${formId}/integrations`;

  if (oauthError || !code) {
    redirectTo.search = "?sheets_error=declined";
    return NextResponse.redirect(redirectTo);
  }

  const { supabase, workspace } = await getCurrentWorkspace();
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

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveConnection(supabase, workspace.id, formId, tokens);
    redirectTo.search = "?sheets_connected=1";
  } catch {
    redirectTo.search = "?sheets_error=exchange_failed";
  }

  return NextResponse.redirect(redirectTo);
}
