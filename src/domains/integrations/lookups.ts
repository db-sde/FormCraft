import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { parseFormSchema } from "@/domains/forms/schema";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { getWorkspacePlan } from "@/domains/billing/entitlements";
import { formatAnswerValue } from "@/domains/responses/format";
import { decryptJson, encryptJson, type EncryptedPayload } from "@/domains/sheets/crypto";
import {
  isDisallowedWebhookHost,
  resolvesToDisallowedAddress,
} from "@/domains/webhooks/url-safety";

type Client = SupabaseClient<Database>;

/**
 * Data lookups (logic spec phase 24): external data during a response.
 * When the respondent leaves a chosen question, the server calls the
 * creator's API (GET, JSON) and copies fields from the reply into the
 * form's URL fields, which rules, formulas and recall already read.
 *
 * A respondent can trigger an outbound request, so everything about it
 * is fixed by the creator and bounded here:
 * - the host comes only from the saved URL; answers are inserted
 *   percent-encoded into its path or query and can never change it;
 * - HTTPS to a public address only (the same checks as webhooks), no
 *   redirects, a 4-second limit and a 64 KB reply;
 * - the secret header is encrypted at rest and never leaves the server;
 * - at most {@link MAX_CALLS_PER_RESPONSE} calls per response;
 * - only URL fields the served version declares are written, as short
 *   strings.
 * A failed lookup never blocks the form: it just leaves the fields as
 * they were.
 */

export const MAX_LOOKUPS_PER_FORM = 5;
export const MAX_CALLS_PER_RESPONSE = 10;
const TIMEOUT_MS = 4000;
const MAX_REPLY_BYTES = 64 * 1024;
const MAX_VALUE_CHARS = 500;

const TOKEN = /\{\{\s*answer:([A-Za-z0-9_-]{1,64})(?:\.([a-z]{1,20}))?\s*\}\}/g;

export const LookupInput = z.object({
  name: z.string().trim().min(1).max(80),
  triggerQuestionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  url: z.string().trim().min(10).max(2000),
  headerName: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,64}$/)
    .nullable(),
  /** Null keeps the saved value (when editing). */
  headerValue: z.string().max(2000).nullable(),
  outputs: z
    .array(
      z.object({
        field: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
        path: z.string().regex(/^[A-Za-z0-9_$.[\]-]{1,200}$/),
      }),
    )
    .min(1)
    .max(10),
});
export type LookupInput = z.infer<typeof LookupInput>;

export class LookupError extends Error {}

/** Headers a lookup may not set (they'd change where or how it's sent). */
const FORBIDDEN_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "cookie",
  "accept-encoding",
]);

/** Checks a URL template when it's saved. Returns its host. */
export async function validateLookupUrl(template: string): Promise<string> {
  const scheme = template.indexOf("://");
  const pathStart = scheme < 0 ? -1 : template.indexOf("/", scheme + 3);
  const origin = pathStart < 0 ? template : template.slice(0, pathStart);
  if (origin.includes("{{") || origin.includes("}}"))
    throw new LookupError(
      "Answers can go in the path or the query, not in the address itself.",
    );
  let parsed: URL;
  try {
    parsed = new URL(template.replace(TOKEN, "x"));
  } catch {
    throw new LookupError("Enter a valid URL.");
  }
  if (parsed.username || parsed.password)
    throw new LookupError("Put credentials in the header, not the URL.");
  const localHttp =
    process.env.NODE_ENV !== "production" &&
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (parsed.protocol !== "https:" && !localHttp)
    throw new LookupError("Lookup URLs must use HTTPS.");
  if (
    isDisallowedWebhookHost(parsed.hostname) ||
    (await resolvesToDisallowedAddress(parsed.hostname))
  ) {
    throw new LookupError(
      "Lookup URLs must point to a public address, not a private network.",
    );
  }
  return parsed.host;
}

/** The URL to call for these answers. Each token becomes the answer as
 * text, percent-encoded; the host is checked to be the template's. */
export function buildLookupUrl(
  template: string,
  schema: FormSchemaV1,
  answers: Record<string, unknown>,
): URL {
  const expected = new URL(template.replace(TOKEN, "x"));
  const filled = template.replace(TOKEN, (_, questionId: string, field?: string) => {
    const question = schema.questions.find((q) => q.id === questionId);
    if (!question) return "";
    const value = answers[questionId];
    const text =
      field && value && typeof value === "object" && !Array.isArray(value)
        ? String((value as Record<string, unknown>)[field] ?? "")
        : formatAnswerValue(question, value);
    return encodeURIComponent(text.slice(0, MAX_VALUE_CHARS));
  });
  const url = new URL(filled);
  if (url.host !== expected.host || url.protocol !== expected.protocol)
    throw new LookupError("The lookup URL changed its address.");
  return url;
}

/** `a.b[0].c` in a JSON reply. Only text, numbers and booleans come
 * back (as short text); anything else is "not found". */
export function extractPath(data: unknown, path: string): string | null {
  let current: unknown = data;
  for (const part of path
    .replace(/^\$\.?/, "")
    .split(/\.|\[|\]/)
    .filter(Boolean)) {
    if (current === null || typeof current !== "object") return null;
    if (part === "__proto__" || part === "constructor" || part === "prototype")
      return null;
    current = Array.isArray(current)
      ? /^\d+$/.test(part)
        ? current[Number(part)]
        : undefined
      : Object.prototype.hasOwnProperty.call(current, part)
        ? (current as Record<string, unknown>)[part]
        : undefined;
  }
  if (typeof current === "string") return current.slice(0, MAX_VALUE_CHARS);
  if (typeof current === "number" && Number.isFinite(current)) return String(current);
  if (typeof current === "boolean") return current ? "true" : "false";
  return null;
}

type Row = Database["public"]["Tables"]["form_lookups"]["Row"];
type Output = { field: string; path: string };

export type LookupSummary = {
  id: string;
  name: string;
  triggerQuestionId: string;
  url: string;
  headerName: string | null;
  outputs: Output[];
  enabled: boolean;
};

const outputsOf = (row: Pick<Row, "outputs">): Output[] =>
  Array.isArray(row.outputs)
    ? (row.outputs as unknown[]).filter(
        (o): o is Output =>
          !!o &&
          typeof (o as Output).field === "string" &&
          typeof (o as Output).path === "string",
      )
    : [];

/** A form's lookups, without the secret header's value. */
export async function listLookups(
  admin: Client,
  formId: string,
): Promise<LookupSummary[]> {
  const { data, error } = await admin
    .from("form_lookups")
    .select("id, name, trigger_question_id, url, header_name, outputs, enabled")
    .eq("form_id", formId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    triggerQuestionId: row.trigger_question_id,
    url: row.url,
    headerName: row.header_name,
    outputs: outputsOf(row),
    enabled: row.enabled,
  }));
}

/** What the public form needs to know: which questions trigger a lookup
 * and which URL fields lookups fill (so those aren't taken from the URL). */
export async function lookupPlan(
  admin: Client,
  formId: string,
): Promise<{ triggers: string[]; fields: string[] }> {
  const { data } = await admin
    .from("form_lookups")
    .select("trigger_question_id, outputs")
    .eq("form_id", formId)
    .eq("enabled", true);
  return {
    triggers: [...new Set((data ?? []).map((r) => r.trigger_question_id))],
    fields: [...new Set((data ?? []).flatMap((r) => outputsOf(r).map((o) => o.field)))],
  };
}

/** Creates or replaces a lookup (service role; the caller checked the
 * user and the plan). */
export async function saveLookup(
  admin: Client,
  formId: string,
  input: LookupInput,
  options: { id?: string; createdBy: string },
): Promise<string> {
  const parsed = LookupInput.safeParse(input);
  if (!parsed.success) throw new LookupError("Check the lookup's settings.");
  const value = parsed.data;
  await validateLookupUrl(value.url);
  if (value.headerName && FORBIDDEN_HEADERS.has(value.headerName.toLowerCase()))
    throw new LookupError(`The ${value.headerName} header can't be set.`);
  if (new Set(value.outputs.map((o) => o.field)).size !== value.outputs.length)
    throw new LookupError("Each URL field can be filled once.");

  const base = {
    name: value.name,
    trigger_question_id: value.triggerQuestionId,
    url: value.url,
    outputs: value.outputs as unknown as Json,
  };
  if (options.id) {
    const header =
      value.headerName === null
        ? { header_name: null, encrypted_header: null }
        : value.headerValue === null
          ? { header_name: value.headerName }
          : {
              header_name: value.headerName,
              encrypted_header: encryptJson(value.headerValue) as unknown as Json,
            };
    const { data, error } = await admin
      .from("form_lookups")
      .update({ ...base, ...header })
      .eq("id", options.id)
      .eq("form_id", formId)
      .select("id");
    if (error || !data?.length) throw new LookupError("Couldn't save the lookup.");
    return options.id;
  }
  if (value.headerName && !value.headerValue)
    throw new LookupError("Enter the header's value.");
  const { count } = await admin
    .from("form_lookups")
    .select("id", { count: "exact", head: true })
    .eq("form_id", formId);
  if ((count ?? 0) >= MAX_LOOKUPS_PER_FORM)
    throw new LookupError(`A form can have up to ${MAX_LOOKUPS_PER_FORM} lookups.`);
  const { data, error } = await admin
    .from("form_lookups")
    .insert({
      ...base,
      form_id: formId,
      header_name: value.headerName,
      encrypted_header: value.headerName
        ? (encryptJson(value.headerValue) as unknown as Json)
        : null,
      created_by: options.createdBy,
    })
    .select("id")
    .single();
  if (error || !data) throw new LookupError("Couldn't save the lookup.");
  return data.id;
}

export async function deleteLookup(
  admin: Client,
  formId: string,
  id: string,
): Promise<void> {
  const { error } = await admin
    .from("form_lookups")
    .delete()
    .eq("id", id)
    .eq("form_id", formId);
  if (error) throw error;
}

/** One GET, bounded in every direction. Null on any failure. */
async function fetchJson(
  url: URL,
  header: { name: string; value: string } | null,
  fetchImpl: typeof fetch,
): Promise<unknown | null> {
  if (
    isDisallowedWebhookHost(url.hostname) ||
    (await resolvesToDisallowedAddress(url.hostname))
  ) {
    return null;
  }
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "FormCraft-Lookup/1",
        ...(header ? { [header.name]: header.value } : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_REPLY_BYTES) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REPLY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Runs the lookups a question triggers for an unfinished response and
 * stores what they return in its URL fields. Returns the fields that
 * changed (for the browser's copy of the logic). Never throws for a
 * failed or slow API.
 */
export async function runLookups(
  admin: Client,
  responseId: string,
  questionId: string,
  answers: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, string>> {
  const { data: response } = await admin
    .from("responses")
    .select(
      "id, status, form_id, form_version_id, hidden_fields, lookup_calls, forms!inner(workspace_id)",
    )
    .eq("id", responseId)
    .maybeSingle();
  if (!response || response.status === "completed") return {};

  const { data: lookups } = await admin
    .from("form_lookups")
    .select("id, url, header_name, encrypted_header, outputs")
    .eq("form_id", response.form_id)
    .eq("trigger_question_id", questionId)
    .eq("enabled", true)
    .order("created_at", { ascending: true });
  if (!lookups?.length) return {};

  const workspaceId = (response.forms as { workspace_id: string }).workspace_id;
  const { entitlements } = await getWorkspacePlan(admin, workspaceId);
  if (!entitlements.data_lookups) return {};

  const { data: version } = await admin
    .from("form_versions")
    .select("schema")
    .eq("id", response.form_version_id)
    .single();
  if (!version) return {};
  const schema = parseFormSchema(version.schema);
  const declared = new Set((schema.hiddenFields ?? []).map((f) => f.name));
  const known = Object.fromEntries(
    Object.entries(answers).filter(([id]) => schema.questions.some((q) => q.id === id)),
  );

  const values: Record<string, string> = {};
  let calls = response.lookup_calls;
  for (const lookup of lookups) {
    if (calls >= MAX_CALLS_PER_RESPONSE) break;
    calls += 1;
    // Counted before the call, so retries can't run past the cap.
    await admin.from("responses").update({ lookup_calls: calls }).eq("id", responseId);
    let url: URL;
    try {
      url = buildLookupUrl(lookup.url, schema, known);
    } catch {
      continue;
    }
    const header =
      lookup.header_name && lookup.encrypted_header
        ? {
            name: lookup.header_name,
            value: decryptJson<string>(
              lookup.encrypted_header as unknown as EncryptedPayload,
            ),
          }
        : null;
    const reply = await fetchJson(url, header, fetchImpl);
    if (reply === null) continue;
    for (const output of outputsOf(lookup)) {
      if (!declared.has(output.field)) continue;
      const value = extractPath(reply, output.path);
      if (value !== null) values[output.field] = value;
    }
  }
  if (Object.keys(values).length === 0) return {};

  const current =
    response.hidden_fields &&
    typeof response.hidden_fields === "object" &&
    !Array.isArray(response.hidden_fields)
      ? (response.hidden_fields as Record<string, Json>)
      : {};
  const { error } = await admin
    .from("responses")
    .update({ hidden_fields: { ...current, ...values } })
    .eq("id", responseId)
    .neq("status", "completed");
  if (error) return {};
  return values;
}
