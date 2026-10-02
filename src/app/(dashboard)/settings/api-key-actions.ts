"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { API_SCOPES, ApiKeyError, createApiKey, type ApiScope } from "@/domains/api";
import { canAdmin } from "@/domains/workspaces";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/domains/audit";

export type ApiKeyResult = { ok: true; key?: string } | { ok: false; message: string };

/** Creates a key; the secret is returned this once and never again. */
export async function createApiKeyAction(
  name: string,
  scopes: ApiScope[] = [...API_SCOPES],
): Promise<ApiKeyResult> {
  const { user, workspace } = await getCurrentWorkspace();
  if (!canAdmin(workspace.role))
    return { ok: false, message: "Only the owner and admins can make API keys." };
  try {
    const { key } = await createApiKey(createAdminClient(), {
      workspaceId: workspace.id,
      name,
      createdBy: user.id,
      scopes: scopes.filter((s) => (API_SCOPES as readonly string[]).includes(s)),
    });
    await audit(createAdminClient(), {
      workspaceId: workspace.id,
      actorId: user.id,
      action: "api_key.created",
      metadata: { name: name.trim().slice(0, 80) },
    });
    revalidatePath("/settings");
    return { ok: true, key };
  } catch (error) {
    if (error instanceof ApiKeyError) return { ok: false, message: error.message };
    return { ok: false, message: "Couldn't create the key. Please try again." };
  }
}

/** Revokes a key: it stops working at once and its Zapier / Make
 * subscriptions are removed (database trigger). */
export async function revokeApiKeyAction(keyId: string): Promise<ApiKeyResult> {
  if (!z.string().uuid().safeParse(keyId).success)
    return { ok: false, message: "Key not found." };
  const { supabase, workspace } = await getCurrentWorkspace();
  const { data, error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("workspace_id", workspace.id)
    .is("revoked_at", null)
    .select("id");
  if (error || !data?.length)
    return { ok: false, message: "Only the owner and admins can revoke keys." };
  await audit(createAdminClient(), {
    workspaceId: workspace.id,
    actorId: (await supabase.auth.getUser()).data.user?.id ?? null,
    action: "api_key.revoked",
    target: { type: "api_key", id: keyId },
  });
  revalidatePath("/settings");
  return { ok: true };
}
