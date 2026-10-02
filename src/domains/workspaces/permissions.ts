import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * Granular permissions (PRD P3.15): role defaults with per-member
 * overrides, decided in the database (`has_permission`, migration 34) so
 * row-level security and server checks agree. Owners and admins always
 * have everything.
 */

export const PERMISSIONS = [
  "view_responses",
  "export_responses",
  "publish",
  "manage_integrations",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABEL: Record<Permission, string> = {
  view_responses: "See responses",
  export_responses: "Export responses",
  publish: "Publish forms",
  manage_integrations: "Manage integrations",
};

export type PermissionOverrides = Partial<Record<Permission, boolean>>;

export function effectivePermissions(
  role: string,
  overrides: PermissionOverrides,
): Record<Permission, boolean> {
  return Object.fromEntries(
    PERMISSIONS.map((p) => {
      if (role === "owner" || role === "admin") return [p, true];
      if (typeof overrides[p] === "boolean") return [p, overrides[p]];
      return [p, role === "editor" ? true : p === "view_responses"];
    }),
  ) as Record<Permission, boolean>;
}

export function sanitizeOverrides(input: unknown): PermissionOverrides {
  if (!input || typeof input !== "object") return {};
  const out: PermissionOverrides = {};
  for (const p of PERMISSIONS) {
    const value = (input as Record<string, unknown>)[p];
    if (typeof value === "boolean") out[p] = value;
  }
  return out;
}

/** The signed-in user's permission in a workspace (server check). */
export async function hasPermission(
  supabase: Client,
  workspaceId: string,
  permission: Permission,
): Promise<boolean> {
  const { data } = await supabase.rpc("has_permission", {
    target_workspace_id: workspaceId,
    permission,
  });
  return data === true;
}
