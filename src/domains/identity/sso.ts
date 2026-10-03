import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getWorkspacePlan, withinLimit } from "@/domains/billing/entitlements";
import { seatsTaken } from "@/domains/workspaces/team";

type Client = SupabaseClient<Database>;

/**
 * SAML single sign-on (PRD P3.12). Supabase Auth holds the SAML
 * connection; `workspace_sso` maps that provider to a workspace. An
 * operator registers the provider and the mapping (scripts/set-sso.ts);
 * workspace admins only choose the default role and whether SSO is
 * required. Requiring it is enforced in the database (`sso_satisfied`),
 * with the owner exempt so a broken identity provider can't lock the
 * workspace out.
 */

export type SsoSettings = {
  domain: string;
  enforced: boolean;
  defaultRole: "editor" | "viewer";
};

export async function getSsoSettings(
  supabase: Client,
  workspaceId: string,
): Promise<SsoSettings | null> {
  const { data } = await supabase
    .from("workspace_sso")
    .select("domain, enforced, default_role")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return data
    ? {
        domain: data.domain,
        enforced: data.enforced,
        defaultRole: data.default_role as SsoSettings["defaultRole"],
      }
    : null;
}

/** The email's domain, when it has a usable one. */
export function emailDomain(email: string): string | null {
  const match = /^[^@\s]+@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(email.trim());
  return match ? match[1].toLowerCase() : null;
}

/** The SSO provider ids this user has signed in with (`sso:<uuid>`). */
export function ssoProviderIds(user: Pick<User, "app_metadata">): string[] {
  const providers = [
    user.app_metadata?.provider,
    ...((user.app_metadata?.providers as unknown[] | undefined) ?? []),
  ];
  return [
    ...new Set(
      providers
        .filter((p): p is string => typeof p === "string" && p.startsWith("sso:"))
        .map((p) => p.slice(4)),
    ),
  ];
}

/**
 * After an SSO sign-in: adds the person to the workspace their identity
 * provider belongs to, if they aren't in it yet. When the workspace uses
 * SCIM, only people its directory lists as active may join; otherwise
 * anyone the provider signs in does, with the default role. Returns the
 * workspace to open, or null when there's nothing to join.
 */
export async function joinSsoWorkspace(
  admin: Client,
  user: Pick<User, "id" | "email" | "app_metadata">,
): Promise<{ workspaceId: string; joined: boolean } | null> {
  const providerIds = ssoProviderIds(user);
  if (providerIds.length === 0) return null;
  const { data: sso } = await admin
    .from("workspace_sso")
    .select("workspace_id, default_role")
    .in("provider_id", providerIds)
    .limit(1)
    .maybeSingle();
  if (!sso) return null;
  const workspaceId = sso.workspace_id;
  const { entitlements } = await getWorkspacePlan(admin, workspaceId);
  if (!entitlements.sso) return null;

  const email = (user.email ?? "").toLowerCase();
  const { data: token } = await admin
    .from("scim_tokens")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (token && entitlements.scim) {
    const { data: listed } = await admin
      .from("scim_users")
      .select("id, active")
      .eq("workspace_id", workspaceId)
      .eq("email", email)
      .maybeSingle();
    if (!listed?.active) return null;
    await admin.from("scim_users").update({ user_id: user.id }).eq("id", listed.id);
  }

  const { data: member } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (member) return { workspaceId, joined: false };
  if (!withinLimit(entitlements, "members", await seatsTaken(admin, workspaceId), 1))
    return null;
  const { error } = await admin.from("workspace_members").insert({
    workspace_id: workspaceId,
    user_id: user.id,
    role: sso.default_role as "editor" | "viewer",
  });
  if (error) throw error;
  return { workspaceId, joined: true };
}

/** How many of this user's workspaces this session can't open because
 * they require SSO. */
export async function workspacesNeedingSso(supabase: Client): Promise<number> {
  const { data } = await supabase.rpc("workspaces_requiring_sso");
  return data ?? 0;
}
