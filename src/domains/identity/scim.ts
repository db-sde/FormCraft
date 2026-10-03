import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getWorkspacePlan } from "@/domains/billing/entitlements";

type Client = SupabaseClient<Database>;

/**
 * SCIM 2.0 provisioning (PRD P3.18), Users only. The identity provider
 * keeps the workspace's directory (`scim_users`) in step with its own:
 * who may join and who no longer may. Accounts aren't created here —
 * Supabase never links an SSO sign-in to an existing account — so a
 * listed person becomes a member when they first sign in with SSO, and
 * deactivating or deleting them removes their membership at once.
 *
 * One bearer token per workspace ("scim_" + 32 random bytes), shown
 * once and stored as SHA-256. Every request re-checks the plan.
 */

export const SCIM_TOKEN_PREFIX = "scim_";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
export const SCIM_PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
export const SCIM_MAX_RESULTS = 100;

export class ScimError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly scimType?: string,
  ) {
    super(message);
    this.name = "ScimError";
  }
}

/** A new token, replacing any old one. The returned secret is the only copy. */
export async function createScimToken(
  admin: Client,
  workspaceId: string,
  createdBy: string,
): Promise<string> {
  const token = `${SCIM_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const { error } = await admin.from("scim_tokens").upsert({
    workspace_id: workspaceId,
    token_hash: hash(token),
    prefix: token.slice(0, 10),
    created_by: createdBy,
    created_at: new Date().toISOString(),
    last_used_at: null,
  });
  if (error) throw error;
  return token;
}

export async function revokeScimToken(admin: Client, workspaceId: string): Promise<void> {
  const { error } = await admin
    .from("scim_tokens")
    .delete()
    .eq("workspace_id", workspaceId);
  if (error) throw error;
}

/** The workspace a `Bearer scim_…` header belongs to, if its plan
 * still includes SCIM. */
export async function authenticateScim(
  admin: Client,
  authorization: string | null,
): Promise<string | null> {
  const match = /^Bearer (scim_[A-Za-z0-9_-]{20,})$/.exec(authorization ?? "");
  if (!match) return null;
  const { data } = await admin
    .from("scim_tokens")
    .select("workspace_id, last_used_at")
    .eq("token_hash", hash(match[1]))
    .maybeSingle();
  if (!data) return null;
  const { entitlements } = await getWorkspacePlan(admin, data.workspace_id);
  if (!entitlements.scim) return null;
  // At most one write a minute for "last used".
  if (!data.last_used_at || Date.now() - Date.parse(data.last_used_at) > 60_000) {
    await admin
      .from("scim_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("workspace_id", data.workspace_id);
  }
  return data.workspace_id;
}

type Row = Database["public"]["Tables"]["scim_users"]["Row"];

export type ScimUser = {
  schemas: string[];
  id: string;
  externalId?: string;
  userName: string;
  displayName?: string;
  name?: { formatted: string };
  emails: { value: string; primary: true }[];
  active: boolean;
  meta: { resourceType: "User"; created: string; lastModified: string; location: string };
};

export function toScimUser(row: Row, baseUrl: string): ScimUser {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: row.id,
    ...(row.external_id ? { externalId: row.external_id } : {}),
    userName: row.email,
    ...(row.display_name
      ? { displayName: row.display_name, name: { formatted: row.display_name } }
      : {}),
    emails: [{ value: row.email, primary: true }],
    active: row.active,
    meta: {
      resourceType: "User",
      created: row.created_at,
      lastModified: row.updated_at,
      location: `${baseUrl}/Users/${row.id}`,
    },
  };
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** What a create / replace body says about the user. */
export function readScimUser(body: unknown): {
  email: string;
  displayName: string | null;
  externalId: string | null;
  active: boolean;
} {
  const b = (body ?? {}) as Record<string, unknown>;
  const emails = Array.isArray(b.emails)
    ? (b.emails as { value?: unknown; primary?: unknown }[])
    : [];
  const primary = emails.find((e) => e?.primary === true) ?? emails[0];
  const raw =
    typeof b.userName === "string" && EMAIL.test(b.userName.trim())
      ? b.userName
      : typeof primary?.value === "string"
        ? primary.value
        : "";
  const email = raw.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 320)
    throw new ScimError(400, "userName must be an email address.", "invalidValue");
  const name = b.name as
    { formatted?: unknown; givenName?: unknown; familyName?: unknown } | undefined;
  const displayName =
    (typeof b.displayName === "string" && b.displayName.trim()) ||
    (typeof name?.formatted === "string" && name.formatted.trim()) ||
    [name?.givenName, name?.familyName]
      .filter((p) => typeof p === "string" && p)
      .join(" ") ||
    null;
  return {
    email,
    displayName: displayName ? displayName.slice(0, 200) : null,
    externalId: typeof b.externalId === "string" ? b.externalId.slice(0, 200) : null,
    active: b.active !== false && b.active !== "false",
  };
}

/** `userName eq "a@b.co"` (or `emails.value eq …`), the filter identity
 * providers use to look someone up; anything else isn't supported. */
export function parseScimFilter(filter: string | null): string | null {
  if (!filter) return null;
  const match =
    /^\s*(?:userName|emails(?:\.value|\[type eq "work"\]\.value)?)\s+eq\s+"([^"]*)"\s*$/i.exec(
      filter,
    );
  if (!match)
    throw new ScimError(400, 'Only userName eq "…" is supported.', "invalidFilter");
  return match[1].trim().toLowerCase();
}

export async function listScimUsers(
  admin: Client,
  workspaceId: string,
  options: { email: string | null; startIndex: number; count: number },
): Promise<{ rows: Row[]; total: number }> {
  let query = admin
    .from("scim_users")
    .select("*", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (options.email !== null) query = query.eq("email", options.email);
  const from = Math.max(0, options.startIndex - 1);
  const { data, count, error } = await query.range(
    from,
    from + Math.max(0, options.count) - 1,
  );
  if (error) throw error;
  return { rows: options.count === 0 ? [] : (data ?? []), total: count ?? 0 };
}

export async function getScimUser(
  admin: Client,
  workspaceId: string,
  id: string,
): Promise<Row> {
  const { data } = await admin
    .from("scim_users")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (!data) throw new ScimError(404, "User not found.");
  return data;
}

/** Removes the membership of everyone with this email — except the
 * owner, who can only be changed inside the app. */
async function removeMembership(
  admin: Client,
  workspaceId: string,
  row: Row,
): Promise<number> {
  const { data: profiles } = await admin
    .from("profiles")
    .select("id")
    .eq("email", row.email);
  const ids = [
    ...new Set([
      ...(profiles ?? []).map((p) => p.id),
      ...(row.user_id ? [row.user_id] : []),
    ]),
  ];
  if (ids.length === 0) return 0;
  const { data, error } = await admin
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .in("user_id", ids)
    .neq("role", "owner")
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function createScimUser(
  admin: Client,
  workspaceId: string,
  body: unknown,
): Promise<Row> {
  const user = readScimUser(body);
  const { data, error } = await admin
    .from("scim_users")
    .insert({
      workspace_id: workspaceId,
      email: user.email,
      display_name: user.displayName,
      external_id: user.externalId,
      active: user.active,
    })
    .select("*")
    .single();
  if (error?.code === "23505")
    throw new ScimError(409, "A user with that userName already exists.", "uniqueness");
  if (error || !data) throw error ?? new ScimError(500, "Couldn't create the user.");
  return data;
}

/** Applies a change (PUT, or PATCH already reduced to fields). Turning
 * `active` off removes their membership. */
export async function updateScimUser(
  admin: Client,
  workspaceId: string,
  id: string,
  change: Partial<{
    email: string;
    displayName: string | null;
    externalId: string | null;
    active: boolean;
  }>,
): Promise<{ row: Row; removedMembers: number }> {
  const current = await getScimUser(admin, workspaceId, id);
  const { data, error } = await admin
    .from("scim_users")
    .update({
      ...(change.email !== undefined ? { email: change.email } : {}),
      ...(change.displayName !== undefined ? { display_name: change.displayName } : {}),
      ...(change.externalId !== undefined ? { external_id: change.externalId } : {}),
      ...(change.active !== undefined ? { active: change.active } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select("*")
    .single();
  if (error?.code === "23505")
    throw new ScimError(409, "A user with that userName already exists.", "uniqueness");
  if (error || !data) throw error ?? new ScimError(500, "Couldn't update the user.");
  const removedMembers =
    current.active && !data.active
      ? await removeMembership(admin, workspaceId, current)
      : 0;
  return { row: data, removedMembers };
}

export async function deleteScimUser(
  admin: Client,
  workspaceId: string,
  id: string,
): Promise<{ email: string; removedMembers: number }> {
  const current = await getScimUser(admin, workspaceId, id);
  const removedMembers = await removeMembership(admin, workspaceId, current);
  const { error } = await admin.from("scim_users").delete().eq("id", id);
  if (error) throw error;
  return { email: current.email, removedMembers };
}

/** PATCH operations → fields. Supports what Okta and Entra send:
 * replace/add of `active`, `userName`, `displayName`, `externalId`,
 * `name.formatted`, either by path or as a value object. */
export function readScimPatch(body: unknown): Parameters<typeof updateScimUser>[3] {
  const ops = (body as { Operations?: unknown })?.Operations;
  if (!Array.isArray(ops))
    throw new ScimError(400, "Operations is required.", "invalidSyntax");
  const change: Parameters<typeof updateScimUser>[3] = {};
  const set = (path: string, value: unknown) => {
    const key = path.toLowerCase();
    if (key === "active")
      change.active = value !== false && value !== "false" && value !== "False";
    else if (key === "username") {
      const email = String(value ?? "")
        .trim()
        .toLowerCase();
      if (!EMAIL.test(email))
        throw new ScimError(400, "userName must be an email address.", "invalidValue");
      change.email = email;
    } else if (key === "displayname" || key === "name.formatted")
      change.displayName = value ? String(value).slice(0, 200) : null;
    else if (key === "externalid")
      change.externalId = value ? String(value).slice(0, 200) : null;
    // Anything else (title, groups, …) isn't stored; ignoring it is allowed.
  };
  for (const op of ops as { op?: unknown; path?: unknown; value?: unknown }[]) {
    const kind = String(op?.op ?? "").toLowerCase();
    if (kind !== "replace" && kind !== "add")
      throw new ScimError(400, "Only add and replace are supported.", "invalidSyntax");
    if (typeof op.path === "string") set(op.path, op.value);
    else if (op.value && typeof op.value === "object")
      for (const [path, value] of Object.entries(op.value as Record<string, unknown>))
        set(path, value);
  }
  return change;
}
