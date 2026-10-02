import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { formatAnswerValue } from "@/domains/responses/format";
import { loadCredential, markCredentialInvalid } from "./credentials";

type Client = SupabaseClient<Database>;

/**
 * HubSpot (PRD P2.15) with a private-app access token (Settings →
 * Integrations in HubSpot; scopes crm.objects.contacts.write/read). Each
 * form maps its fields to contact properties explicitly; email is
 * required, since contacts are matched (updated or created) by email.
 * Deliveries go through the webhook queue, so failures are retried and
 * shown in the delivery log; a 401 marks the connection as needing a new
 * token.
 */

export type HubspotMapping = Record<string, string>; // property → questionId[.field]

const apiBase = () => process.env.HUBSPOT_API_BASE ?? "https://api.hubapi.com";

export function isHubspotToken(token: string): boolean {
  return /^pat-[a-z0-9]+-[A-Za-z0-9-]{20,}$/.test(token);
}

/** Check a token works before saving it. */
export async function verifyHubspotToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(
      `${apiBase()}/crm/v3/properties/contacts?archived=false`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** The contact properties for one response, from the mapping. */
export function contactProperties(
  schema: FormSchemaV1,
  answers: Record<string, unknown>,
  mapping: HubspotMapping,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [property, source] of Object.entries(mapping)) {
    const [questionId, field] = source.split(".");
    const question = schema.questions.find((q) => q.id === questionId);
    if (!question) continue;
    const raw = answers[questionId];
    const value =
      field && raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)[field]
        : question.type === "file_upload"
          ? undefined // uploads are private; never sent out
          : raw;
    if (value === undefined || value === null || value === "") continue;
    const text =
      typeof value === "string" && field ? value : formatAnswerValue(question, value);
    if (text) out[property] = text.slice(0, 65_000);
  }
  return out;
}

/** Problems with a mapping, for the builder's check. */
export function mappingProblems(schema: FormSchemaV1, mapping: HubspotMapping): string[] {
  const problems: string[] = [];
  if (!mapping.email)
    problems.push(
      "Map a question to the Email property — contacts are matched by email.",
    );
  for (const [property, source] of Object.entries(mapping)) {
    if (!/^[a-z][a-z0-9_]{0,99}$/.test(property))
      problems.push(`“${property}” isn't a HubSpot property name.`);
    const [questionId] = source.split(".");
    if (!schema.questions.some((q) => q.id === questionId)) {
      problems.push(`The question mapped to ${property} no longer exists.`);
    }
  }
  return problems;
}

export type HubspotResult = { status: "succeeded" | "failed"; error?: string };

/** Creates or updates the contact for a response (by email). */
export async function sendToHubspot(
  admin: Client,
  input: {
    workspaceId: string;
    schema: FormSchemaV1;
    answers: Record<string, unknown>;
    mapping: HubspotMapping;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<HubspotResult> {
  const credential = await loadCredential<{ token: string }>(
    admin,
    input.workspaceId,
    "hubspot",
  );
  if (!credential) return { status: "failed", error: "HubSpot isn't connected" };
  const properties = contactProperties(input.schema, input.answers, input.mapping);
  if (!properties.email)
    return { status: "failed", error: "no email answer to match the contact by" };
  const headers = {
    Authorization: `Bearer ${credential.token}`,
    "Content-Type": "application/json",
  };
  try {
    const update = await fetchImpl(
      `${apiBase()}/crm/v3/objects/contacts/${encodeURIComponent(properties.email)}?idProperty=email`,
      { method: "PATCH", headers, body: JSON.stringify({ properties }) },
    );
    if (update.ok) return { status: "succeeded" };
    if (update.status === 401) {
      await markCredentialInvalid(admin, input.workspaceId, "hubspot");
      return { status: "failed", error: "HubSpot rejected the token; reconnect it" };
    }
    if (update.status !== 404)
      return { status: "failed", error: `HubSpot said HTTP ${update.status}` };
    const create = await fetchImpl(`${apiBase()}/crm/v3/objects/contacts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ properties }),
    });
    if (create.ok) return { status: "succeeded" };
    const detail = await create.text().catch(() => "");
    return {
      status: "failed",
      error: `HubSpot said HTTP ${create.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "network error",
    };
  }
}
