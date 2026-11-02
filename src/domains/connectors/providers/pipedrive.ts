import { PipedriveSettings, type FieldInfo } from "../catalog";
import {
  providerCall,
  registerAction,
  type ActionResult,
  type Connection,
} from "../framework";
import { asList, asNumber, asText, loadSync, mappingProblem } from "../links";
import type { MappingValue } from "../mapping";
import { configCall, type ProviderAdapter } from "./shared";

/**
 * Pipedrive (F-40). A response creates or updates a person, matched by
 * email (an exact search first), and optionally a lead for them. The
 * lead's title ends with the response's short id, and a person's leads
 * are checked for it before one is added, so a retry never makes a second.
 * Calls go to the company's own domain (`api_domain` from the token).
 * Pipedrive rate-limits per token in 2-second windows; 429 retries.
 */

const STANDARD = new Set(["name", "email", "phone"]);
const SUPPORTED = new Set([
  "varchar",
  "varchar_auto",
  "text",
  "double",
  "monetary",
  "phone",
  "date",
  "enum",
  "set",
  "address",
]);

type PersonField = {
  key: string;
  name: string;
  field_type: string;
  edit_flag?: boolean;
  mandatory_flag?: boolean;
  options?: { id: number; label: string }[];
};

export function pipedriveBase(connection: Connection): string | null {
  const raw = connection.tokens.extra?.api_domain;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname.endsWith(".pipedrive.com")
      ? `${url.origin}/api/v1`
      : null;
  } catch {
    return null;
  }
}

export function pipedriveFields(fields: PersonField[]): FieldInfo[] {
  return fields
    .filter((f) => STANDARD.has(f.key) || f.edit_flag)
    .map((f) => ({
      key: f.key,
      label: f.name,
      type: f.field_type,
      required: f.key === "name",
      supported: STANDARD.has(f.key) || SUPPORTED.has(f.field_type),
    }));
}

/** A mapped value for a custom field: options by their ids. */
export function pipedriveValue(field: PersonField, value: MappingValue): unknown {
  switch (field.field_type) {
    case "double":
    case "monetary":
      return asNumber(value);
    case "date":
      return String(value).slice(0, 10);
    case "enum": {
      const label = asText(value);
      return field.options?.find((o) => o.label === label)?.id ?? null;
    }
    case "set": {
      const ids = asList(value)
        .map((label) => field.options?.find((o) => o.label === label)?.id)
        .filter((id): id is number => id !== undefined);
      return ids.length ? ids.join(",") : null;
    }
    default:
      return asText(value, 255);
  }
}

export const leadTitle = (formTitle: string, responseId: string) =>
  `${formTitle.slice(0, 180)} · ${responseId.slice(0, 8)}`;

export const pipedrive: ProviderAdapter = {
  async choices() {
    return [];
  },
  async fields(ctx) {
    const base = pipedriveBase(ctx.connection);
    if (!base) return [];
    const data = await configCall<{ data?: PersonField[] }>(
      ctx,
      `${base}/personFields?limit=500`,
    );
    return pipedriveFields(data.data ?? []);
  },
};

registerAction(
  "pipedrive",
  "sync_response",
  async (job, { admin, connection, fetch }) => {
    const loaded = await loadSync(admin, job);
    if (!loaded.ok) return loaded.result;
    const { link, response, fields } = loaded.input;
    const settings = PipedriveSettings.safeParse(link.settings);
    if (!settings.success) return mappingProblem("Choose what to create");
    const base = pipedriveBase(connection);
    if (!base)
      return mappingProblem(
        "The Pipedrive connection has no company domain; reconnect it",
      );
    const token = connection.tokens.accessToken;

    const described = await providerCall(fetch, `${base}/personFields?limit=500`, {
      token,
    });
    if (!described.ok) return described.result;
    const all = (described.data as { data?: PersonField[] }).data ?? [];
    const byKey = new Map(all.map((f) => [f.key, f]));
    const supported = new Map(pipedriveFields(all).map((f) => [f.key, f]));

    const email = asText(fields.email ?? null, 255)?.toLowerCase() ?? null;
    if (!email || !email.includes("@"))
      return mappingProblem("Map an answer to Email: people are matched on it");
    const person: Record<string, unknown> = {};
    const problems: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
      if (key === "email") continue;
      const info = supported.get(key);
      const field = byKey.get(key);
      if (!info || !field) problems.push(`"${key}" isn't a field you can write`);
      else if (!info.supported)
        problems.push(`"${info.label}" (${info.type}) can't be filled`);
      else if (key === "name") person.name = asText(value, 255);
      else if (key === "phone")
        person.phone = [{ value: asText(value, 100), primary: true }];
      else {
        const v = pipedriveValue(field, value);
        if (v === null)
          problems.push(`"${info.label}" has no option or value matching the answer`);
        else person[key] = v;
      }
    }
    if (problems.length) return mappingProblem(`Mapping: ${problems.join("; ")}`);

    const search = await providerCall(
      fetch,
      `${base}/persons/search?term=${encodeURIComponent(email)}&fields=email&exact_match=true&limit=1`,
      { token },
    );
    if (!search.ok) return search.result;
    const existing = (search.data as { data?: { items?: { item: { id: number } }[] } })
      .data?.items?.[0]?.item.id;
    let personId = existing;
    if (existing) {
      if (Object.keys(person).length) {
        const res = await providerCall(fetch, `${base}/persons/${existing}`, {
          token,
          method: "PUT",
          body: JSON.stringify(person),
        });
        if (!res.ok) return res.result;
      }
    } else {
      const res = await providerCall(fetch, `${base}/persons`, {
        token,
        method: "POST",
        body: JSON.stringify({
          name: person.name ?? email,
          ...person,
          email: [{ value: email, primary: true, label: "work" }],
        }),
      });
      if (!res.ok) return res.result;
      personId = (res.data as { data?: { id?: number } }).data?.id;
    }
    if (!personId)
      return { ok: false, retry: true, error: "Pipedrive didn't return the person" };

    let leadId: string | undefined;
    if (settings.data.target === "lead") {
      const title = leadTitle(response.form.title, response.id);
      const leads = await providerCall(
        fetch,
        `${base}/leads?person_id=${personId}&limit=500`,
        {
          token,
        },
      );
      if (!leads.ok) return leads.result;
      leadId = (
        (leads.data as { data?: { id: string; title: string }[] }).data ?? []
      ).find((l) => l.title === title)?.id;
      if (!leadId) {
        const res = await providerCall(fetch, `${base}/leads`, {
          token,
          method: "POST",
          body: JSON.stringify({ title, person_id: personId }),
        });
        if (!res.ok) return res.result;
        leadId = (res.data as { data?: { id?: string } }).data?.id;
      }
    }
    return {
      ok: true,
      result: { personId, created: !existing, ...(leadId ? { leadId } : {}) },
    } satisfies ActionResult;
  },
);
