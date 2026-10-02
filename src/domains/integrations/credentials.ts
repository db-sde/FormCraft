import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { decryptJson, encryptJson, type EncryptedPayload } from "@/domains/sheets/crypto";

type Client = SupabaseClient<Database>;

/**
 * Third-party credentials (HubSpot tokens, Stripe keys): encrypted with
 * AES-256-GCM before they're stored, kept in a table only the server can
 * read, never sent to a browser. One per provider per workspace.
 * Service-role client only.
 */

export type Provider = "hubspot" | "stripe";

export async function saveCredential(
  admin: Client,
  workspaceId: string,
  provider: Provider,
  secret: unknown,
  label: string,
): Promise<void> {
  const { error } = await admin.from("integration_credentials").upsert(
    {
      workspace_id: workspaceId,
      provider,
      encrypted: encryptJson(secret) as unknown as Json,
      label,
      status: "ok",
    },
    { onConflict: "workspace_id,provider" },
  );
  if (error) throw error;
}

export async function loadCredential<T>(
  admin: Client,
  workspaceId: string,
  provider: Provider,
): Promise<T | null> {
  const { data } = await admin
    .from("integration_credentials")
    .select("encrypted")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .maybeSingle();
  if (!data) return null;
  return decryptJson<T>(data.encrypted as unknown as EncryptedPayload);
}

export async function markCredentialInvalid(
  admin: Client,
  workspaceId: string,
  provider: Provider,
): Promise<void> {
  await admin
    .from("integration_credentials")
    .update({ status: "invalid" })
    .eq("workspace_id", workspaceId)
    .eq("provider", provider);
}

export async function deleteCredential(
  admin: Client,
  workspaceId: string,
  provider: Provider,
): Promise<void> {
  await admin
    .from("integration_credentials")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("provider", provider);
}

/** A key or token shortened for display: "pat-na1-…1a2b". */
export function maskSecret(secret: string): string {
  return secret.length <= 12 ? "••••" : `${secret.slice(0, 8)}…${secret.slice(-4)}`;
}
