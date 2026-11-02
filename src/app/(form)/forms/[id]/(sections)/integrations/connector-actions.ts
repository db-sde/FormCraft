"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAdmin, canEdit } from "@/domains/workspaces";
import { hasPermission } from "@/domains/workspaces/permissions";
import { audit } from "@/domains/audit";
import { Condition } from "@/domains/forms/schema/logic-model";
import { revokeConnection } from "@/domains/connectors/framework";
import { TokenError } from "@/domains/connectors/oauth";
import {
  isLinkProvider,
  linkRow,
  workspaceConnection,
  type LinkProvider,
} from "@/domains/connectors/links";
import { Mapping } from "@/domains/connectors/mapping";
import {
  SETTINGS_SCHEMAS,
  type Choice,
  type FieldInfo,
} from "@/domains/connectors/catalog";
import { ADAPTERS } from "@/domains/connectors/providers";
import { AppError, type ApiCtx } from "@/domains/connectors/providers/shared";

type Fail = { ok: false; message: string };
const NO_PERMISSION: Fail = {
  ok: false,
  message: "You need permission to manage integrations to change this.",
};

/** Editors of the form who may manage integrations (server check; the
 * table's policy checks the same). */
async function manager(formId: string, provider: string) {
  if (!isLinkProvider(provider)) return null;
  const { supabase, workspace, user } = await getCurrentWorkspace();
  if (!canEdit(workspace.role)) return null;
  if (
    !canAdmin(workspace.role) &&
    !(await hasPermission(supabase, workspace.id, "manage_integrations"))
  )
    return null;
  const { data: form } = await supabase
    .from("forms")
    .select("id")
    .eq("id", formId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  return form ? { supabase, workspace, user, provider: provider as LinkProvider } : null;
}

async function apiCtx(
  workspaceId: string,
  provider: LinkProvider,
): Promise<ApiCtx | null> {
  const admin = createAdminClient();
  const connection = await workspaceConnection(admin, workspaceId, provider);
  return connection ? { admin, connection, fetch } : null;
}

function readable(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof TokenError) return "The app refused the connection. Reconnect it.";
  return "Couldn't reach the app. Please try again.";
}

/** Options for a settings picker (bases, tables, databases, audiences). */
export async function connectorChoicesAction(
  formId: string,
  provider: string,
  source: string,
  parent?: string,
): Promise<{ ok: true; choices: Choice[] } | Fail> {
  const ctx = await manager(formId, provider);
  if (!ctx) return NO_PERMISSION;
  const api = await apiCtx(ctx.workspace.id, ctx.provider);
  if (!api) return { ok: false, message: "Connect the app first." };
  try {
    return {
      ok: true,
      choices: await ADAPTERS[ctx.provider].choices(api, source.slice(0, 40), parent),
    };
  } catch (error) {
    return { ok: false, message: readable(error) };
  }
}

/** The destination's fields, with the ones that can't be filled. */
export async function connectorFieldsAction(
  formId: string,
  provider: string,
  settings: Record<string, unknown>,
): Promise<{ ok: true; fields: FieldInfo[] } | Fail> {
  const ctx = await manager(formId, provider);
  if (!ctx) return NO_PERMISSION;
  const api = await apiCtx(ctx.workspace.id, ctx.provider);
  if (!api) return { ok: false, message: "Connect the app first." };
  try {
    return { ok: true, fields: await ADAPTERS[ctx.provider].fields(api, settings) };
  } catch (error) {
    return { ok: false, message: readable(error) };
  }
}

const LinkInput = z.object({
  enabled: z.boolean(),
  settings: z.record(z.string(), z.unknown()),
  mapping: Mapping,
  condition: Condition.nullable(),
});

/** Saves the form's link to an app (one per app). */
export async function saveConnectorLinkAction(
  formId: string,
  provider: string,
  input: z.input<typeof LinkInput>,
): Promise<{ ok: true } | Fail> {
  const parsed = LinkInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the mapping and condition." };
  const ctx = await manager(formId, provider);
  if (!ctx) return NO_PERMISSION;
  const settings = SETTINGS_SCHEMAS[ctx.provider].safeParse(parsed.data.settings);
  if (!settings.success) {
    return { ok: false, message: "Choose where responses go before saving." };
  }
  const s = settings.data as Record<string, unknown>;
  if (ctx.provider === "salesforce" && s.dedupe === "external_id" && !s.externalIdField) {
    return { ok: false, message: "Choose the External ID field to match on." };
  }
  const fields = parsed.data.mapping.map((r) => r.field);
  if (new Set(fields).size !== fields.length) {
    return { ok: false, message: "Each field can only be filled once." };
  }
  const { error } = await ctx.supabase.from("connector_links").upsert(
    {
      ...linkRow({
        formId,
        provider: ctx.provider,
        enabled: parsed.data.enabled,
        settings: s,
        mapping: parsed.data.mapping,
        condition: parsed.data.condition,
      }),
      created_by: ctx.user.id,
    },
    { onConflict: "form_id,provider" },
  );
  if (error) return { ok: false, message: "Couldn't save. Please try again." };
  revalidatePath(`/forms/${formId}/integrations`);
  return { ok: true };
}

/** Removes the form's link to an app (the app stays connected). */
export async function deleteConnectorLinkAction(
  formId: string,
  provider: string,
): Promise<{ ok: true } | Fail> {
  const ctx = await manager(formId, provider);
  if (!ctx) return NO_PERMISSION;
  const { error } = await ctx.supabase
    .from("connector_links")
    .delete()
    .eq("form_id", formId)
    .eq("provider", ctx.provider);
  if (error) return { ok: false, message: "Couldn't remove it. Please try again." };
  revalidatePath(`/forms/${formId}/integrations`);
  return { ok: true };
}

/** Disconnects the workspace from an app: every form stops syncing to it,
 * and its queued syncs are skipped (replayable after reconnecting). */
export async function disconnectAppAction(
  formId: string,
  provider: string,
): Promise<{ ok: true } | Fail> {
  const ctx = await manager(formId, provider);
  if (!ctx) return NO_PERMISSION;
  const admin = createAdminClient();
  // Working or needing reconnection: either way it's this workspace's.
  const { data: connection } = await admin
    .from("connector_connections")
    .select("id")
    .eq("workspace_id", ctx.workspace.id)
    .eq("provider", ctx.provider)
    .is("user_id", null)
    .neq("status", "revoked")
    .maybeSingle();
  if (!connection) return { ok: true };
  await revokeConnection(admin, connection.id);
  await audit(admin, {
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    action: "integration.disconnected",
    metadata: { provider: ctx.provider },
  });
  revalidatePath(`/forms/${formId}/integrations`);
  return { ok: true };
}
