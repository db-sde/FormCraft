import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * Feature switches (developer spec 26 Nov 2026, release checklist): staff
 * can turn a feature off for everyone or for one workspace from the admin
 * portal. All start on. Read through the database, cached for 30 seconds
 * per server instance; a failed read leaves the feature on.
 */
export { FEATURE_FLAGS, FLAG_LABEL, type FeatureFlag } from "./flag-labels";
import type { FeatureFlag } from "./flag-labels";

const cache = new Map<string, { on: boolean; until: number }>();

export async function featureEnabled(
  key: FeatureFlag,
  workspaceId: string | null,
  admin?: Client,
): Promise<boolean> {
  const id = `${key}:${workspaceId ?? "*"}`;
  const hit = cache.get(id);
  if (hit && hit.until > Date.now()) return hit.on;
  let on = true;
  try {
    const client = admin ?? (await import("@/lib/supabase/admin")).createAdminClient();
    const { data, error } = await client.rpc("feature_enabled", {
      p_key: key,
      p_workspace_id: workspaceId as string,
    });
    on = error ? true : data !== false;
  } catch {
    on = true;
  }
  if (cache.size > 5000) cache.clear();
  cache.set(id, { on, until: Date.now() + 30_000 });
  return on;
}

export const SWITCHED_OFF = "This is switched off for now. Please try again later.";
