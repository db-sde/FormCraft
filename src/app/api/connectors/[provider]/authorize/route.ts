import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { canAdmin, canEdit } from "@/domains/workspaces";
import { hasPermission } from "@/domains/workspaces/permissions";
import {
  authorizeUrl,
  CONNECT_COOKIE,
  CONNECT_TTL_SECONDS,
  createConnectState,
  isConfigured,
  oauthProvider,
  safeReturnPath,
} from "@/domains/connectors/oauth";

/** Calendars are personal (each host connects their own); the rest are
 * the workspace's and need the right to manage integrations. */
const PERSONAL = new Set(["google_calendar"]);

/**
 * Starts connecting a provider (spec §5.3): checks who may, binds the
 * flow to this user and browser (signed state + httpOnly nonce cookie,
 * PKCE where supported) and sends them to the provider.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const back = safeReturnPath(request.nextUrl.searchParams.get("returnTo"));
  const fail = (code: string) => {
    const url = new URL(back, request.nextUrl.origin);
    url.searchParams.set("connect_error", code);
    return NextResponse.redirect(url);
  };
  const config = oauthProvider(provider);
  if (!config) return fail("unknown");
  if (!isConfigured(provider)) return fail("not_configured");
  const { supabase, workspace, user } = await getCurrentWorkspace();
  const personal = PERSONAL.has(provider);
  if (!personal) {
    const allowed =
      canAdmin(workspace.role) ||
      (canEdit(workspace.role) &&
        (await hasPermission(supabase, workspace.id, "manage_integrations")));
    if (!allowed) return fail("forbidden");
  }
  const { state, nonce } = createConnectState({
    provider,
    workspaceId: workspace.id,
    userId: user.id,
    personal,
    returnTo: back,
  });
  const response = NextResponse.redirect(authorizeUrl(provider, state, nonce));
  response.cookies.set(CONNECT_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/connectors",
    maxAge: CONNECT_TTL_SECONDS,
  });
  return response;
}
