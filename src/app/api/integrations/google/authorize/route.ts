import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { buildAuthorizeUrl, isGoogleOAuthConfigured } from "@/domains/sheets";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";

/**
 * Starts the Google OAuth flow for connecting a form's Sheets
 * integration. Session-authenticated (never the admin client) —
 * requires the caller to actually be a member of the workspace that
 * owns `formId`, same as every other creator-facing route.
 */
export async function GET(request: NextRequest) {
  const formId = request.nextUrl.searchParams.get("formId");
  if (!formId) {
    return NextResponse.json(
      { error: { code: "invalid_body", message: "Missing formId." } },
      { status: 400 },
    );
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

  if (!isGoogleOAuthConfigured()) {
    const url = request.nextUrl.clone();
    url.pathname = `/forms/${formId}/integrations`;
    url.search = "?sheets_error=not_configured";
    return NextResponse.redirect(url);
  }

  return NextResponse.redirect(buildAuthorizeUrl(formId));
}
