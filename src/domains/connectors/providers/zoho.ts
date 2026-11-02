import { ZohoSettings, type FieldInfo } from "../catalog";
import {
  providerCall,
  registerAction,
  type ActionResult,
  type Connection,
} from "../framework";
import { asBoolean, asList, asNumber, asText, loadSync, mappingProblem } from "../links";
import type { MappingValue } from "../mapping";
import { configCall, type ProviderAdapter } from "./shared";

/**
 * Zoho CRM (F-40). A response creates or updates a lead or contact with
 * Zoho's upsert, matched on Email (`duplicate_check_fields`), so a retry
 * updates what the first try made. Calls go to the account's own data
 * centre (`api_domain` from the token). Zoho counts API credits per day;
 * 429 retries with backoff.
 */

const SUPPORTED = new Set([
  "text",
  "textarea",
  "email",
  "phone",
  "website",
  "picklist",
  "multiselectpicklist",
  "integer",
  "bigint",
  "double",
  "decimal",
  "currency",
  "percent",
  "boolean",
  "date",
  "datetime",
]);

type ZohoField = {
  api_name: string;
  field_label: string;
  data_type: string;
  system_mandatory?: boolean;
  read_only?: boolean;
  field_read_only?: boolean;
};

export function zohoBase(connection: Connection): string | null {
  const raw = connection.tokens.extra?.api_domain;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && /(^|\.)zohoapis\.[a-z.]+$/.test(url.hostname)
      ? `${url.origin}/crm/v6`
      : null;
  } catch {
    return null;
  }
}

const auth = (connection: Connection) => ({
  authorization: `Zoho-oauthtoken ${connection.tokens.accessToken}`,
});

export function zohoFields(fields: ZohoField[]): FieldInfo[] {
  return fields
    .filter((f) => !f.read_only && !f.field_read_only)
    .map((f) => ({
      key: f.api_name,
      label: f.field_label,
      type: f.data_type,
      required: Boolean(f.system_mandatory),
      supported: SUPPORTED.has(f.data_type),
    }));
}

export function zohoValue(type: string, value: MappingValue): unknown {
  switch (type) {
    case "integer":
    case "bigint":
    case "double":
    case "decimal":
    case "currency":
    case "percent":
      return asNumber(value);
    case "boolean":
      return asBoolean(value);
    case "multiselectpicklist":
      return asList(value);
    case "date":
      return String(value).slice(0, 10);
    case "textarea":
      return asText(value, 32_000);
    default:
      return asText(value, 255);
  }
}

export const zoho: ProviderAdapter = {
  async choices() {
    return [];
  },
  async fields(ctx, settings) {
    const mod = (settings as { module?: string }).module;
    const base = zohoBase(ctx.connection);
    if (!base || (mod !== "Leads" && mod !== "Contacts")) return [];
    const data = await configCall<{ fields?: ZohoField[] }>(
      ctx,
      `${base}/settings/fields?module=${mod}`,
      { headers: auth(ctx.connection) },
    );
    return zohoFields(data.fields ?? []);
  },
};

registerAction("zoho_crm", "sync_response", async (job, { admin, connection, fetch }) => {
  const loaded = await loadSync(admin, job);
  if (!loaded.ok) return loaded.result;
  const { link, fields } = loaded.input;
  const settings = ZohoSettings.safeParse(link.settings);
  if (!settings.success) return mappingProblem("Choose leads or contacts");
  const base = zohoBase(connection);
  if (!base) return mappingProblem("The Zoho connection has no API domain; reconnect it");
  const token = connection.tokens.accessToken;
  const headers = auth(connection);

  const described = await providerCall(
    fetch,
    `${base}/settings/fields?module=${settings.data.module}`,
    { token, headers },
  );
  if (!described.ok) return described.result;
  const info = new Map(
    zohoFields((described.data as { fields?: ZohoField[] }).fields ?? []).map((f) => [
      f.key,
      f,
    ]),
  );

  const record: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const field = info.get(key);
    if (!field) problems.push(`"${key}" isn't a field you can write`);
    else if (!field.supported)
      problems.push(`"${field.label}" (${field.type}) can't be filled`);
    else {
      const v = zohoValue(field.type, value);
      if (v === null) problems.push(`"${field.label}" needs a ${field.type}`);
      else record[key] = v;
    }
  }
  const missing = [...info.values()]
    .filter((f) => f.required && record[f.key] === undefined)
    .map((f) => f.label);
  if (missing.length) problems.push(`required but empty: ${missing.join(", ")}`);
  if (typeof record.Email !== "string")
    problems.push("map an answer to Email: records are matched on it");
  if (problems.length) return mappingProblem(`Mapping: ${problems.join("; ")}`);

  const res = await providerCall(fetch, `${base}/${settings.data.module}/upsert`, {
    token,
    headers,
    method: "POST",
    body: JSON.stringify({ data: [record], duplicate_check_fields: ["Email"] }),
  });
  if (!res.ok) return res.result;
  const row = (
    res.data as {
      data?: {
        status?: string;
        action?: string;
        message?: string;
        details?: { id?: string; api_name?: string };
      }[];
    }
  ).data?.[0];
  if (row?.status !== "success") {
    const field = row?.details?.api_name ? ` (${row.details.api_name})` : "";
    return mappingProblem(`Zoho said: ${row?.message ?? "not saved"}${field}`);
  }
  return {
    ok: true,
    result: { id: row.details?.id, created: row.action === "insert" },
  } satisfies ActionResult;
});
