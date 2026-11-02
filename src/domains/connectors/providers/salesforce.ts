import { SalesforceSettings, type FieldInfo } from "../catalog";
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
 * Salesforce (F-34). A response creates or updates a Lead or Contact.
 * Duplicates are matched by email (a SOQL query, then update or create)
 * or by an External ID field holding the response ID (an upsert) — either
 * way a retry after a timeout finds what the first try made. Leads can run
 * the org's assignment rules (routing). Tokens don't say when they expire:
 * a refusal refreshes once (framework) before the connection is marked
 * for reconnecting. API limits are per org per day; 429/503 retry.
 */

const VERSION = "v62.0";

const SUPPORTED = new Set([
  "string",
  "textarea",
  "email",
  "phone",
  "url",
  "picklist",
  "multipicklist",
  "combobox",
  "boolean",
  "double",
  "currency",
  "percent",
  "int",
  "long",
  "date",
  "datetime",
]);

type Described = {
  name: string;
  label: string;
  type: string;
  createable: boolean;
  updateable: boolean;
  nillable: boolean;
  defaultedOnCreate: boolean;
  externalId: boolean;
};

export function instanceBase(connection: Connection): string | null {
  const raw = connection.tokens.extra?.instance_url;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function salesforceFields(described: Described[]): FieldInfo[] {
  return described
    .filter((f) => f.createable || f.updateable)
    .map((f) => ({
      key: f.name,
      label: f.label,
      type: f.type,
      required:
        f.createable && !f.nillable && !f.defaultedOnCreate && f.type !== "boolean",
      supported: SUPPORTED.has(f.type),
      tags: f.externalId ? ["externalId"] : undefined,
    }));
}

export function salesforceValue(type: string, value: MappingValue): unknown {
  switch (type) {
    case "boolean":
      return asBoolean(value);
    case "double":
    case "currency":
    case "percent":
    case "int":
    case "long":
      return asNumber(value);
    case "date":
      return String(value).slice(0, 10);
    case "multipicklist":
      return asList(value).join(";");
    case "textarea":
      return asText(value, 32_000);
    default:
      return asText(value, 255);
  }
}

/** A string literal for SOQL. */
export function soqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export const salesforce: ProviderAdapter = {
  async choices() {
    return [];
  },
  async fields(ctx, settings) {
    const object = (settings as { object?: string }).object;
    const base = instanceBase(ctx.connection);
    if (!base || (object !== "Lead" && object !== "Contact")) return [];
    const data = await configCall<{ fields: Described[] }>(
      ctx,
      `${base}/services/data/${VERSION}/sobjects/${object}/describe`,
    );
    return salesforceFields(data.fields ?? []);
  },
};

registerAction(
  "salesforce",
  "sync_response",
  async (job, { admin, connection, fetch }) => {
    const loaded = await loadSync(admin, job);
    if (!loaded.ok) return loaded.result;
    const { link, response, fields } = loaded.input;
    const parsed = SalesforceSettings.safeParse(link.settings);
    if (!parsed.success) return mappingProblem("Choose what to create and how to match");
    const settings = parsed.data;
    const base = instanceBase(connection);
    if (!base)
      return mappingProblem("The Salesforce connection has no instance; reconnect it");
    const token = connection.tokens.accessToken;
    const root = `${base}/services/data/${VERSION}`;

    const described = await providerCall(
      fetch,
      `${root}/sobjects/${settings.object}/describe`,
      {
        token,
      },
    );
    if (!described.ok) return described.result;
    const info = new Map(
      salesforceFields((described.data as { fields?: Described[] }).fields ?? []).map(
        (f) => [f.key, f],
      ),
    );

    const record: Record<string, unknown> = {};
    const problems: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
      const field = info.get(key);
      if (!field) problems.push(`"${key}" isn't a field you can write`);
      else if (!field.supported)
        problems.push(`"${field.label}" (${field.type}) can't be filled`);
      else {
        const v = salesforceValue(field.type, value);
        if (v === null) problems.push(`"${field.label}" needs a ${field.type}`);
        else record[key] = v;
      }
    }
    const missing = [...info.values()]
      .filter((f) => f.required && record[f.key] === undefined)
      .filter(
        (f) => !(settings.dedupe === "external_id" && f.key === settings.externalIdField),
      )
      .map((f) => f.label);
    if (missing.length) problems.push(`required but empty: ${missing.join(", ")}`);
    if (problems.length) return mappingProblem(`Mapping: ${problems.join("; ")}`);

    const headers: Record<string, string> =
      settings.object === "Lead"
        ? { "sforce-auto-assign": settings.assignmentRules ? "TRUE" : "FALSE" }
        : {};
    const sobject = `${root}/sobjects/${settings.object}`;

    if (settings.dedupe === "external_id") {
      if (
        !settings.externalIdField ||
        !info.get(settings.externalIdField)?.tags?.length
      ) {
        return mappingProblem("Choose a field marked External ID to match on");
      }
      delete record[settings.externalIdField];
      const res = await providerCall(
        fetch,
        `${sobject}/${encodeURIComponent(settings.externalIdField)}/${encodeURIComponent(response.id)}`,
        { token, method: "PATCH", body: JSON.stringify(record), headers },
      );
      if (!res.ok) return res.result;
      const data = res.data as { id?: string; created?: boolean } | null;
      return { ok: true, result: { id: data?.id, created: res.status === 201 } };
    }

    const email = typeof record.Email === "string" ? record.Email : null;
    if (!email)
      return mappingProblem("Map an answer to Email: records are matched on it");
    const where = settings.object === "Lead" ? " AND IsConverted = false" : "";
    const query = `SELECT Id FROM ${settings.object} WHERE Email = ${soqlString(email)}${where} ORDER BY CreatedDate DESC LIMIT 1`;
    const found = await providerCall(
      fetch,
      `${root}/query?q=${encodeURIComponent(query)}`,
      {
        token,
      },
    );
    if (!found.ok) return found.result;
    const existing = (found.data as { records?: { Id: string }[] }).records?.[0]?.Id;
    if (existing) {
      const res = await providerCall(
        fetch,
        `${sobject}/${encodeURIComponent(existing)}`,
        {
          token,
          method: "PATCH",
          body: JSON.stringify(record),
          headers,
        },
      );
      if (!res.ok) return res.result;
      return {
        ok: true,
        result: { id: existing, created: false },
      } satisfies ActionResult;
    }
    const res = await providerCall(fetch, sobject, {
      token,
      method: "POST",
      body: JSON.stringify(record),
      headers,
    });
    if (!res.ok) return res.result;
    return { ok: true, result: { id: (res.data as { id?: string }).id, created: true } };
  },
);
