import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getWorkspacePlan } from "@/domains/billing/entitlements";

type Client = SupabaseClient<Database>;

/**
 * Workspace API keys (Zapier / Make now, the public API later). A key is
 * "fc_live_" + 32 random bytes, shown once; the database keeps only its
 * SHA-256 and a short prefix to recognise it. Every request re-checks
 * the plan's `api_access`, so a downgrade cuts access straight away.
 */

export const KEY_PREFIX = "fc_live_";

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

export class ApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiKeyError";
  }
}

export type ApiKeySummary = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export async function listApiKeys(
  supabase: Client,
  workspaceId: string,
): Promise<ApiKeySummary[]> {
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, prefix, created_at, last_used_at")
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    createdAt: k.created_at,
    lastUsedAt: k.last_used_at,
  }));
}

/** A new key (service role; the caller checked the user is an admin).
 * The returned secret is the only copy. */
export async function createApiKey(
  admin: Client,
  input: { workspaceId: string; name: string; createdBy: string },
): Promise<{ id: string; key: string }> {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new ApiKeyError("Name the key, e.g. “Zapier”.");
  const { entitlements } = await getWorkspacePlan(admin, input.workspaceId);
  if (!entitlements.api_access)
    throw new ApiKeyError("API keys are part of the Business plan.");
  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const { data, error } = await admin
    .from("api_keys")
    .insert({
      workspace_id: input.workspaceId,
      name,
      prefix: key.slice(0, KEY_PREFIX.length + 6),
      key_hash: hash(key),
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id, key };
}

export type ApiCaller = { keyId: string; workspaceId: string };

/** The workspace an `Authorization: Bearer fc_live_…` header belongs to,
 * if the key is live and the plan still includes the API. */
export async function authenticateApiKey(
  admin: Client,
  authorization: string | null,
): Promise<ApiCaller | null> {
  const key = /^Bearer (fc_live_[A-Za-z0-9_-]{43})$/.exec(authorization ?? "")?.[1];
  if (!key) return null;
  const { data } = await admin
    .from("api_keys")
    .select("id, workspace_id, revoked_at, last_used_at")
    .eq("key_hash", hash(key))
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  const { entitlements } = await getWorkspacePlan(admin, data.workspace_id);
  if (!entitlements.api_access) return null;
  // Note use at most once a minute.
  if (!data.last_used_at || Date.now() - new Date(data.last_used_at).getTime() > 60_000) {
    await admin
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id);
  }
  return { keyId: data.id, workspaceId: data.workspace_id };
}
