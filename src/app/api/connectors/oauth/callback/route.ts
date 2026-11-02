import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  CONNECT_COOKIE,
  exchangeCode,
  verifyConnectState,
} from "@/domains/connectors/oauth";
import { saveConnection } from "@/domains/connectors/framework";
import { accountLabel } from "@/domains/connectors/accounts";
import { audit } from "@/domains/audit";

/**
 * Where providers send the browser back (spec §5.3). The state must be
 * ours, unexpired, for the signed-in user, and match this browser's
 * cookie; the workspace must still be theirs. Tokens are encrypted at
 * rest and never reach the browser.
 */
export async function GET(request: NextRequest) {
  const { workspace, user } = await getCurrentWorkspace();
  const verified = verifyConnectState(request.nextUrl.searchParams.get("state"), {
    userId: user.id,
    cookieNonce: request.cookies.get(CONNECT_COOKIE)?.value,
  });
  const done = (path: string, params: Record<string, string>) => {
    const url = new URL(path, request.nextUrl.origin);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = NextResponse.redirect(url);
    res.cookies.delete({ name: CONNECT_COOKIE, path: "/api/connectors" });
    return res;
  };
  if (!verified.ok) return done("/settings", { connect_error: "expired" });
  const { value } = verified;
  if (value.workspaceId !== workspace.id)
    return done(value.returnTo, { connect_error: "workspace" });
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return done(value.returnTo, { connect_error: "declined" });
  try {
    const tokens = await exchangeCode(value.provider, code, verified.nonce);
    const admin = createAdminClient();
    const label = await accountLabel(value.provider, tokens).catch(() => null);
    await saveConnection(admin, {
      workspaceId: workspace.id,
      userId: value.personal ? user.id : null,
      provider: value.provider,
      tokens,
      label,
      createdBy: user.id,
    });
    await audit(admin, {
      workspaceId: workspace.id,
      actorId: user.id,
      action: "integration.connected",
      metadata: { provider: value.provider, personal: value.personal },
    });
    return done(value.returnTo, { connected: value.provider });
  } catch {
    return done(value.returnTo, { connect_error: "exchange_failed" });
  }
}
