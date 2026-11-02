import { AirtableSettings, type FieldInfo } from "../catalog";
import { providerCall, registerAction, type ActionResult } from "../framework";
import { asBoolean, asList, asNumber, asText, loadSync, mappingProblem } from "../links";
import type { MappingValue } from "../mapping";
import { byName, configCall, type ApiCtx, type ProviderAdapter } from "./shared";

/**
 * Airtable (F-33). A response becomes a record, upserted on a text field
 * holding the response ID (`performUpsert.fieldsToMergeOn`), so a retry
 * after a timeout updates the record it already made. Fields are keyed by
 * their Airtable ids, so renaming a field doesn't break the mapping.
 * Quota: 5 requests a second per base — a 429 retries with backoff.
 */

const api = () => process.env.AIRTABLE_API_BASE ?? "https://api.airtable.com";

const WRITABLE = new Set([
  "singleLineText",
  "multilineText",
  "richText",
  "email",
  "url",
  "phoneNumber",
  "number",
  "currency",
  "percent",
  "rating",
  "duration",
  "checkbox",
  "singleSelect",
  "multipleSelects",
  "date",
  "dateTime",
]);

type Table = {
  id: string;
  name: string;
  fields: { id: string; name: string; type: string }[];
};

function toFields(table: Table): FieldInfo[] {
  return table.fields.map((f) => ({
    key: f.id,
    label: f.name,
    type: f.type,
    required: false,
    supported: WRITABLE.has(f.type),
  }));
}

/** A mapped value as the field's type wants it; a string when it can't be. */
export function airtableValue(
  type: string,
  value: MappingValue,
): { ok: true; value: unknown } | { ok: false; error: string } {
  switch (type) {
    case "number":
    case "currency":
    case "percent":
    case "rating":
    case "duration": {
      const n = asNumber(value);
      return n === null ? { ok: false, error: "needs a number" } : { ok: true, value: n };
    }
    case "checkbox": {
      const b = asBoolean(value);
      return b === null
        ? { ok: false, error: "needs yes or no" }
        : { ok: true, value: b };
    }
    case "multipleSelects":
      return { ok: true, value: asList(value) };
    case "date":
      return { ok: true, value: String(value).slice(0, 10) };
    default:
      return { ok: true, value: asText(value, 100_000) };
  }
}

async function tables(ctx: ApiCtx, baseId: string): Promise<Table[]> {
  const data = await configCall<{ tables: Table[] }>(
    ctx,
    `${api()}/v0/meta/bases/${encodeURIComponent(baseId)}/tables`,
  );
  return data.tables ?? [];
}

export const airtable: ProviderAdapter = {
  async choices(ctx, source, parent) {
    if (source === "bases") {
      const data = await configCall<{ bases: { id: string; name: string }[] }>(
        ctx,
        `${api()}/v0/meta/bases`,
      );
      return (data.bases ?? []).map((b) => ({ id: b.id, name: b.name })).sort(byName);
    }
    if (source === "tables" && parent) {
      return (await tables(ctx, parent)).map((t) => ({ id: t.id, name: t.name }));
    }
    return [];
  },
  async fields(ctx, settings) {
    const { baseId, tableId } = settings as { baseId?: string; tableId?: string };
    if (!baseId || !tableId) return [];
    const table = (await tables(ctx, baseId)).find((t) => t.id === tableId);
    return table ? toFields(table) : [];
  },
};

registerAction("airtable", "sync_response", async (job, { admin, connection, fetch }) => {
  const loaded = await loadSync(admin, job);
  if (!loaded.ok) return loaded.result;
  const { link, response, fields } = loaded.input;
  const settings = AirtableSettings.safeParse(link.settings);
  if (!settings.success)
    return mappingProblem("Choose a base, table and response ID field");
  const { baseId, tableId, matchField } = settings.data;
  const token = connection.tokens.accessToken;

  // The table's current fields: types to convert to, and renamed or
  // deleted ones reported rather than silently dropped.
  const meta = await providerCall(
    fetch,
    `${api()}/v0/meta/bases/${encodeURIComponent(baseId)}/tables`,
    { token },
  );
  if (!meta.ok) return meta.result;
  const table = ((meta.data as { tables?: Table[] }).tables ?? []).find(
    (t) => t.id === tableId,
  );
  if (!table)
    return mappingProblem("The table was deleted or isn't shared with FormCraft");
  const byId = new Map(table.fields.map((f) => [f.id, f]));
  const match = byId.get(matchField);
  if (!match) return mappingProblem("The response ID field was deleted from the table");

  const record: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const field = byId.get(key);
    if (!field) {
      problems.push(`a mapped field no longer exists (${key})`);
      continue;
    }
    if (!WRITABLE.has(field.type)) {
      problems.push(`"${field.name}" (${field.type}) can't be filled`);
      continue;
    }
    const converted = airtableValue(field.type, value);
    if (!converted.ok) problems.push(`"${field.name}" ${converted.error}`);
    else record[key] = converted.value;
  }
  if (problems.length) return mappingProblem(`Mapping: ${problems.join("; ")}`);
  record[matchField] = response.id;

  const res = await providerCall(
    fetch,
    `${api()}/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}`,
    {
      token,
      method: "PATCH",
      body: JSON.stringify({
        performUpsert: { fieldsToMergeOn: [matchField] },
        records: [{ fields: record }],
        typecast: true,
        returnFieldsByFieldId: true,
      }),
    },
  );
  if (!res.ok) return res.result;
  const data = res.data as { records?: { id: string }[]; createdRecords?: string[] };
  const id = data.records?.[0]?.id;
  return {
    ok: true,
    result: { recordId: id, created: Boolean(id && data.createdRecords?.includes(id)) },
  } satisfies ActionResult;
});
