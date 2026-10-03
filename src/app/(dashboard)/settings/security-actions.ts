"use server";

import { revalidatePath } from "next/cache";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/domains/audit";
import { canAdmin } from "@/domains/workspaces";
import { EntitlementError, requireFeature } from "@/domains/billing/entitlements";
import { createScimToken, revokeScimToken } from "@/domains/identity/scim";
import {
  deletePersonData,
  EMAIL_PATTERN,
  exportPersonData,
  findPersonResponses,
  type PersonResponse,
} from "@/domains/responses/privacy";

type Fail = { ok: false; message: string };

async function adminOrFail() {
  const ctx = await getCurrentWorkspace();
  return canAdmin(ctx.workspace.role) ? ctx : null;
}

const ADMINS_ONLY: Fail = {
  ok: false,
  message: "Only the owner and admins can do this.",
};

/** SSO (P3.12): the two settings a workspace admin owns. The provider
 * itself is registered by an operator (scripts/set-sso.ts). */
export async function updateSsoSettingsAction(input: {
  enforced: boolean;
  defaultRole: "editor" | "viewer";
}): Promise<{ ok: true } | Fail> {
  const ctx = await adminOrFail();
  if (!ctx) return ADMINS_ONLY;
  if (!["editor", "viewer"].includes(input.defaultRole))
    return { ok: false, message: "Choose editor or viewer." };
  try {
    await requireFeature(ctx.supabase, ctx.workspace.id, "sso");
  } catch (error) {
    return {
      ok: false,
      message: error instanceof EntitlementError ? error.message : "Not available.",
    };
  }
  const { data, error } = await ctx.supabase
    .from("workspace_sso")
    .update({ enforced: Boolean(input.enforced), default_role: input.defaultRole })
    .eq("workspace_id", ctx.workspace.id)
    .select("workspace_id");
  if (error || !data?.length)
    return {
      ok: false,
      message: "Single sign-on isn't connected for this workspace yet.",
    };
  await audit(createAdminClient(), {
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    action: "security.sso_changed",
    metadata: { enforced: Boolean(input.enforced), default_role: input.defaultRole },
  });
  revalidatePath("/settings");
  return { ok: true };
}

/** SCIM (P3.18): a new token, shown once; any old one stops working. */
export async function createScimTokenAction(): Promise<
  { ok: true; token: string } | Fail
> {
  const ctx = await adminOrFail();
  if (!ctx) return ADMINS_ONLY;
  try {
    await requireFeature(ctx.supabase, ctx.workspace.id, "scim");
  } catch (error) {
    return {
      ok: false,
      message: error instanceof EntitlementError ? error.message : "Not available.",
    };
  }
  const { data: sso } = await ctx.supabase
    .from("workspace_sso")
    .select("workspace_id")
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!sso)
    return {
      ok: false,
      message: "Connect single sign-on first: people join by signing in with it.",
    };
  const admin = createAdminClient();
  const token = await createScimToken(admin, ctx.workspace.id, ctx.user.id);
  await audit(admin, {
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    action: "security.scim_token_created",
  });
  revalidatePath("/settings");
  return { ok: true, token };
}

export async function revokeScimTokenAction(): Promise<{ ok: true } | Fail> {
  const ctx = await adminOrFail();
  if (!ctx) return ADMINS_ONLY;
  const admin = createAdminClient();
  await revokeScimToken(admin, ctx.workspace.id);
  await audit(admin, {
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    action: "security.scim_token_revoked",
  });
  revalidatePath("/settings");
  return { ok: true };
}

const cleanEmail = (email: string) => {
  const value = String(email ?? "")
    .trim()
    .toLowerCase();
  return EMAIL_PATTERN.test(value) && value.length <= 320 ? value : null;
};

/** Privacy requests (P3.17): what the workspace holds about a person. */
export async function findPersonAction(
  email: string,
): Promise<{ ok: true; responses: PersonResponse[] } | Fail> {
  const ctx = await adminOrFail();
  if (!ctx) return ADMINS_ONLY;
  const value = cleanEmail(email);
  if (!value) return { ok: false, message: "Enter an email address." };
  try {
    return {
      ok: true,
      responses: await findPersonResponses(ctx.supabase, ctx.workspace.id, value),
    };
  } catch {
    return { ok: false, message: "Couldn't search. Please try again." };
  }
}

/** Their data as JSON, to hand over. Logged (without the address). */
export async function exportPersonAction(
  email: string,
): Promise<{ ok: true; json: string; count: number } | Fail> {
  const ctx = await adminOrFail();
  if (!ctx) return ADMINS_ONLY;
  const value = cleanEmail(email);
  if (!value) return { ok: false, message: "Enter an email address." };
  try {
    const data = await exportPersonData(ctx.supabase, ctx.workspace.id, value);
    await audit(createAdminClient(), {
      workspaceId: ctx.workspace.id,
      actorId: ctx.user.id,
      action: "privacy.data_exported",
      metadata: { responses: data.responses.length },
    });
    return {
      ok: true,
      json: JSON.stringify(data, null, 2),
      count: data.responses.length,
    };
  } catch {
    return { ok: false, message: "Couldn't export. Please try again." };
  }
}

/** Erases every response carrying that address. The address is typed
 * twice so a slip can't erase the wrong person. */
export async function deletePersonAction(
  email: string,
  confirmation: string,
): Promise<{ ok: true; deleted: number } | Fail> {
  const ctx = await adminOrFail();
  if (!ctx) return ADMINS_ONLY;
  const value = cleanEmail(email);
  if (!value) return { ok: false, message: "Enter an email address." };
  if (cleanEmail(confirmation) !== value)
    return { ok: false, message: "Type the same address again to confirm." };
  try {
    const admin = createAdminClient();
    const { deleted } = await deletePersonData(
      ctx.supabase,
      admin,
      ctx.workspace.id,
      value,
    );
    await audit(admin, {
      workspaceId: ctx.workspace.id,
      actorId: ctx.user.id,
      action: "privacy.data_deleted",
      metadata: { responses: deleted },
    });
    revalidatePath("/settings");
    return { ok: true, deleted };
  } catch {
    return { ok: false, message: "Couldn't delete. Please try again." };
  }
}
