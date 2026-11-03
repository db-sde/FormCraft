import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { Condition } from "@/domains/forms/schema/logic-model";
import {
  conditionHolds,
  loadResponseContext,
  type ResponseContext,
} from "@/domains/responses/context";
import type { ActionResult, Connection } from "./framework";
import { dispatchConnectorJobs, enqueueJob, findConnection } from "./framework";
import { applyMapping, Mapping, type MappingRow, type MappingValue } from "./mapping";

type Client = SupabaseClient<Database>;
type JobRow = Database["public"]["Tables"]["connector_jobs"]["Row"];

/**
 * A form's link to a business app (master spec Phase 6): where its
 * completed responses go, how answers map onto the app's fields and when
 * (an optional condition). One per form and app. Each sync is one job on
 * the shared connector queue, keyed `${provider}:${linkId}:${responseId}`,
 * so a repeat submit, a recovery sweep or a manual replay never queues a
 * second one; the provider action itself dedupes (an upsert on a key) so
 * a retry after a timeout updates rather than duplicates.
 */

export const LINK_PROVIDERS = [
  "airtable",
  "salesforce",
  "notion",
  "mailchimp",
  "zoho_crm",
  "pipedrive",
] as const;
export type LinkProvider = (typeof LINK_PROVIDERS)[number];

export function isLinkProvider(value: string): value is LinkProvider {
  return (LINK_PROVIDERS as readonly string[]).includes(value);
}

export type ConnectorLink = {
  id: string;
  formId: string;
  provider: LinkProvider;
  enabled: boolean;
  settings: Record<string, unknown>;
  mapping: MappingRow[];
  condition: Condition | null;
};

function toLink(
  row: Database["public"]["Tables"]["connector_links"]["Row"],
): ConnectorLink {
  const mapping = Mapping.safeParse(row.mapping);
  const condition = row.condition ? Condition.safeParse(row.condition) : null;
  return {
    id: row.id,
    formId: row.form_id,
    provider: row.provider as LinkProvider,
    enabled: row.enabled,
    settings: (row.settings ?? {}) as Record<string, unknown>,
    mapping: mapping.success ? mapping.data : [],
    condition: condition?.success ? condition.data : null,
  };
}

export async function listLinks(
  supabase: Client,
  formId: string,
): Promise<ConnectorLink[]> {
  const { data } = await supabase
    .from("connector_links")
    .select("*")
    .eq("form_id", formId)
    .order("created_at");
  return (data ?? []).map(toLink);
}

export async function getLink(admin: Client, id: string): Promise<ConnectorLink | null> {
  const { data } = await admin
    .from("connector_links")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ? toLink(data) : null;
}

export function linkRow(link: Omit<ConnectorLink, "id">) {
  return {
    form_id: link.formId,
    provider: link.provider,
    enabled: link.enabled,
    settings: link.settings as Json,
    mapping: link.mapping as unknown as Json,
    condition: (link.condition ?? null) as Json,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Queues a sync for each of the form's enabled links whose condition
 * holds, then runs them. Never throws. A link whose app isn't connected
 * (or was disconnected) still gets its job, which is recorded as skipped
 * on the response's timeline — the creator sees why nothing arrived.
 * Callers skip confidential forms.
 */
export async function enqueueConnectorSyncs(
  admin: Client,
  responseId: string,
  options: { fetch?: typeof fetch; dispatch?: boolean } = {},
): Promise<number> {
  const ctx = await loadResponseContext(admin, responseId);
  if (!ctx || ctx.status !== "completed") return 0;
  const { data: rows } = await admin
    .from("connector_links")
    .select("*")
    .eq("form_id", ctx.form.id)
    .eq("enabled", true);
  let queued = 0;
  for (const link of (rows ?? []).map(toLink)) {
    const job = {
      workspaceId: ctx.form.workspaceId,
      provider: link.provider,
      action: "sync_response",
      idempotencyKey: `${link.provider}:${link.id}:${responseId}`,
      responseId,
      payload: { linkId: link.id },
    };
    if (link.condition && !conditionHolds(ctx, link.condition)) {
      await enqueueJob(admin, {
        ...job,
        connectionId: null,
        skipped: "Its condition didn't match this response",
      });
      continue;
    }
    const connection = await findConnection(admin, ctx.form.workspaceId, link.provider);
    await enqueueJob(admin, {
      ...job,
      connectionId: connection?.status === "ok" ? connection.id : null,
    });
    queued += 1;
  }
  if (queued && options.dispatch !== false) {
    await dispatchConnectorJobs(admin, { fetch: options.fetch, responseId });
  }
  return queued;
}

/** Queues the syncs completed responses should have but don't (the
 * post-response callback failed or was killed). Run by the cron. */
export async function recoverMissingConnectorSyncs(
  admin: Client,
): Promise<{ recovered: number }> {
  const { data, error } = await admin.rpc("responses_missing_connector_sync", {
    p_limit: 100,
  });
  if (error) throw error;
  let recovered = 0;
  for (const row of data ?? []) {
    recovered += await enqueueConnectorSyncs(admin, row.response_id, { dispatch: false });
  }
  return { recovered };
}

export type SyncInput = {
  link: ConnectorLink;
  response: ResponseContext;
  /** The mapped values, empty ones left out. */
  fields: Record<string, MappingValue>;
};

/** What a `sync_response` job needs, or why it can't run. */
export async function loadSync(
  admin: Client,
  job: JobRow,
): Promise<{ ok: true; input: SyncInput } | { ok: false; result: ActionResult }> {
  const stop = (error: string) =>
    ({ ok: false, result: { ok: false, retry: false, error } }) as const;
  const linkId = (job.payload as { linkId?: unknown } | null)?.linkId;
  if (typeof linkId !== "string" || !job.response_id) return stop("Malformed job");
  const link = await getLink(admin, linkId);
  if (!link) return stop("The form's link to this app was removed");
  if (!link.enabled)
    return { ok: false, result: { ok: true, skipped: "The link was turned off" } };
  const response = await loadResponseContext(admin, job.response_id);
  if (!response || response.form.id !== link.formId)
    return stop("The response no longer exists");
  const { data: form } = await admin
    .from("forms")
    .select("confidential")
    .eq("id", link.formId)
    .maybeSingle();
  if (form?.confidential) {
    return {
      ok: false,
      result: { ok: true, skipped: "The form's responses are confidential" },
    };
  }
  return {
    ok: true,
    input: { link, response, fields: applyMapping(response, link.mapping) },
  };
}

/** A provider's error with the field it's about, for the timeline. */
export function mappingProblem(message: string): ActionResult {
  return { ok: false, retry: false, error: message.slice(0, 400) };
}

/** Text as an app wants it: trimmed and capped. */
export function asText(value: MappingValue, max = 2000): string | null {
  if (value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

/** A number from a mapped value, or null when it isn't one. */
export function asNumber(value: MappingValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value)))
    return Number(value);
  return null;
}

export function asBoolean(value: MappingValue): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["yes", "true", "1", "on"].includes(v)) return true;
    if (["no", "false", "0", "off"].includes(v)) return false;
  }
  return null;
}

/** Splits multi-choice text back into its labels: answers read as
 * "A; B" (like exports), so labels may contain commas. */
export function asList(value: MappingValue): string[] {
  if (value === null) return [];
  return String(value)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The connection for a link's app in a workspace, if usable. */
export async function workspaceConnection(
  admin: Client,
  workspaceId: string,
  provider: LinkProvider,
): Promise<Connection | null> {
  const c = await findConnection(admin, workspaceId, provider);
  return c && c.status === "ok" ? c : null;
}
