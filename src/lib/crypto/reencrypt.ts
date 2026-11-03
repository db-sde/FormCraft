import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { credentialContext } from "@/domains/integrations/credentials";
import { connectionContext } from "@/domains/connectors/framework";
import { sheetsContext } from "@/domains/sheets/queries";
import { lookupContext } from "@/domains/integrations/lookups";
import {
  decryptJson,
  encryptJson,
  needsReencryption,
  type EncryptedPayload,
} from "./encryption";

type Client = SupabaseClient<Database>;

type Target = {
  table:
    | "integration_credentials"
    | "connector_connections"
    | "sheets_connections"
    | "form_lookups";
  column: "encrypted" | "encrypted_tokens" | "encrypted_header";
  select: string;
  context: (row: Record<string, unknown>) => string;
};

const TARGETS: Target[] = [
  {
    table: "integration_credentials",
    column: "encrypted",
    select: "id, workspace_id, provider, encrypted",
    context: (r) => credentialContext(String(r.workspace_id), String(r.provider)),
  },
  {
    table: "connector_connections",
    column: "encrypted",
    select: "id, workspace_id, provider, user_id, encrypted",
    context: (r) =>
      connectionContext({
        workspace_id: String(r.workspace_id),
        provider: String(r.provider),
        user_id: (r.user_id as string | null) ?? null,
      }),
  },
  {
    table: "sheets_connections",
    column: "encrypted_tokens",
    select: "id, form_id, encrypted_tokens",
    context: (r) => sheetsContext(String(r.form_id)),
  },
  {
    table: "form_lookups",
    column: "encrypted_header",
    select: "id, form_id, encrypted_header",
    context: (r) => lookupContext(String(r.form_id)),
  },
];

/**
 * Rewrites stored secrets under the current encryption key, bound to
 * their rows (see keys.ts): values from before key ids, and values under
 * an older key. Each row is updated only if it hasn't changed meanwhile.
 * Safe to run again; `dryRun` only counts.
 */
export async function reencryptSecrets(
  admin: Client,
  options: { dryRun?: boolean } = {},
): Promise<{ table: string; checked: number; rewritten: number; failed: number }[]> {
  const report = [];
  for (const target of TARGETS) {
    let checked = 0;
    let rewritten = 0;
    let failed = 0;
    for (let from = 0; ; from += 500) {
      const { data, error } = await admin
        .from(target.table)
        .select(target.select)
        .order("id")
        .range(from, from + 499);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      for (const row of rows) {
        const payload = row[target.column] as EncryptedPayload | null;
        if (!payload) continue;
        checked += 1;
        if (!needsReencryption(payload)) continue;
        try {
          const context = target.context(row);
          const value = decryptJson<unknown>(payload, context);
          if (options.dryRun) {
            rewritten += 1;
            continue;
          }
          // Only if the row still holds the value read (no lost update).
          const { data: updated } = await admin
            .from(target.table)
            .update({
              [target.column]: encryptJson(value, context) as unknown as Json,
            } as never)
            .eq("id", String(row.id))
            .eq(target.column as "id", JSON.stringify(payload))
            .select("id");
          if (updated?.length) rewritten += 1;
        } catch {
          failed += 1;
        }
      }
      if (rows.length < 500) break;
    }
    report.push({ table: target.table, checked, rewritten, failed });
  }
  return report;
}
