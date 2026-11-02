import { NotionSettings, type FieldInfo } from "../catalog";
import { providerCall, registerAction, type ActionResult } from "../framework";
import { asBoolean, asList, asNumber, asText, loadSync, mappingProblem } from "../links";
import type { MappingValue } from "../mapping";
import { byName, configCall, type ProviderAdapter } from "./shared";

/**
 * Notion (F-36). A response becomes a page in a database the creator
 * shared with FormCraft. Before creating, the database is queried for a
 * page whose response ID property already holds this response, so a
 * retry updates that page instead of adding a second. Properties are
 * keyed by their Notion ids (renames don't break the mapping). Notion
 * allows about 3 requests a second; 429 retries with backoff.
 */

const API = "https://api.notion.com/v1";
const HEADERS = { "notion-version": "2022-06-28" };

const SUPPORTED = new Set([
  "title",
  "rich_text",
  "number",
  "checkbox",
  "select",
  "multi_select",
  "status",
  "date",
  "email",
  "phone_number",
  "url",
]);

type Property = { id: string; name: string; type: string };
type Database = {
  id: string;
  title?: { plain_text?: string }[];
  properties?: Record<string, Property>;
};

const text = (content: string) => [
  { type: "text", text: { content: content.slice(0, 2000) } },
];
const optionName = (name: string) => name.replace(/,/g, " ").slice(0, 100);

/** A mapped value as a Notion property value, or an error. */
export function notionValue(
  type: string,
  value: MappingValue,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const s = asText(value) ?? "";
  switch (type) {
    case "title":
      return { ok: true, value: { title: text(s) } };
    case "rich_text":
      return { ok: true, value: { rich_text: text(s) } };
    case "number": {
      const n = asNumber(value);
      return n === null
        ? { ok: false, error: "needs a number" }
        : { ok: true, value: { number: n } };
    }
    case "checkbox": {
      const b = asBoolean(value);
      return b === null
        ? { ok: false, error: "needs yes or no" }
        : { ok: true, value: { checkbox: b } };
    }
    case "select":
      return { ok: true, value: { select: { name: optionName(s) } } };
    case "status":
      return { ok: true, value: { status: { name: s.slice(0, 100) } } };
    case "multi_select":
      return {
        ok: true,
        value: { multi_select: asList(value).map((n) => ({ name: optionName(n) })) },
      };
    case "date":
      return { ok: true, value: { date: { start: s } } };
    case "email":
      return { ok: true, value: { email: s } };
    case "phone_number":
      return { ok: true, value: { phone_number: s } };
    case "url":
      return { ok: true, value: { url: s } };
    default:
      return { ok: false, error: `(${type}) can't be filled` };
  }
}

export function notionFields(db: Database): FieldInfo[] {
  return Object.values(db.properties ?? {}).map((p) => ({
    key: p.id,
    label: p.name,
    type: p.type,
    required: false,
    supported: SUPPORTED.has(p.type),
  }));
}

export const notion: ProviderAdapter = {
  async choices(ctx, source) {
    if (source !== "databases") return [];
    const data = await configCall<{ results?: Database[] }>(ctx, `${API}/search`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        filter: { property: "object", value: "database" },
        page_size: 100,
      }),
    });
    return (data.results ?? [])
      .map((d) => ({
        id: d.id,
        name: d.title?.map((t) => t.plain_text ?? "").join("") || "Untitled",
      }))
      .sort(byName);
  },
  async fields(ctx, settings) {
    const id = (settings as { databaseId?: string }).databaseId;
    if (!id) return [];
    const db = await configCall<Database>(
      ctx,
      `${API}/databases/${encodeURIComponent(id)}`,
      {
        headers: HEADERS,
      },
    );
    return notionFields(db);
  },
};

registerAction("notion", "sync_response", async (job, { admin, connection, fetch }) => {
  const loaded = await loadSync(admin, job);
  if (!loaded.ok) return loaded.result;
  const { link, response, fields } = loaded.input;
  const settings = NotionSettings.safeParse(link.settings);
  if (!settings.success)
    return mappingProblem("Choose a database and response ID property");
  const { databaseId, idProperty } = settings.data;
  const token = connection.tokens.accessToken;
  const dbUrl = `${API}/databases/${encodeURIComponent(databaseId)}`;

  const db = await providerCall(fetch, dbUrl, { token, headers: HEADERS });
  if (!db.ok) {
    if (!db.result.ok && /HTTP 404/.test(db.result.error)) {
      return mappingProblem(
        "The database was deleted or is no longer shared with FormCraft",
      );
    }
    return db.result;
  }
  const props = new Map(notionFields(db.data as Database).map((f) => [f.key, f]));
  const idProp = props.get(idProperty);
  if (!idProp || idProp.type !== "rich_text") {
    return mappingProblem(
      "The response ID property was deleted or isn't a text property",
    );
  }

  const properties: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const prop = props.get(key);
    if (!prop) {
      problems.push(`a mapped property no longer exists (${key})`);
      continue;
    }
    const converted = notionValue(prop.type, value);
    if (!converted.ok) problems.push(`"${prop.label}" ${converted.error}`);
    else properties[key] = converted.value;
  }
  if (problems.length) return mappingProblem(`Mapping: ${problems.join("; ")}`);
  properties[idProperty] = { rich_text: text(response.id) };

  const found = await providerCall(fetch, `${dbUrl}/query`, {
    token,
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      filter: { property: idProperty, rich_text: { equals: response.id } },
      page_size: 1,
    }),
  });
  if (!found.ok) return found.result;
  const existing = (found.data as { results?: { id: string }[] }).results?.[0]?.id;
  const res = existing
    ? await providerCall(fetch, `${API}/pages/${encodeURIComponent(existing)}`, {
        token,
        method: "PATCH",
        headers: HEADERS,
        body: JSON.stringify({ properties }),
      })
    : await providerCall(fetch, `${API}/pages`, {
        token,
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ parent: { database_id: databaseId }, properties }),
      });
  if (!res.ok) return res.result;
  return {
    ok: true,
    result: { pageId: (res.data as { id?: string }).id, created: !existing },
  } satisfies ActionResult;
});
