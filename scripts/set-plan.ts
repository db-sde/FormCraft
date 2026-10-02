/**
 * Puts a workspace on a plan (PRD §7). Until FormCraft has its own
 * checkout, plans are assigned here, with the service role — the only
 * way plan_id and entitlement_overrides can change (see migration 25).
 *
 *   npm run plan:set -- <workspace id or slug> <plan id> ['{"members": 5}']
 *
 * The optional JSON replaces the workspace's overrides (per-workspace
 * exceptions on top of the plan); omit it to keep the current ones.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "../src/lib/supabase/database.types";
import { resolveEntitlements } from "../src/domains/billing/entitlements";

async function main() {
  const [target, planId, overridesJson] = process.argv.slice(2);
  if (!target || !planId) {
    console.error(
      "Usage: npm run plan:set -- <workspace id or slug> <plan id> [overrides JSON]",
    );
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required",
    );
  const admin = createClient<Database>(url, key, { auth: { persistSession: false } });

  const { data: plan } = await admin
    .from("plans")
    .select("id, name, entitlements")
    .eq("id", planId)
    .maybeSingle();
  if (!plan) {
    const { data: plans } = await admin.from("plans").select("id").order("sort_order");
    throw new Error(
      `No plan "${planId}". Plans: ${(plans ?? []).map((p) => p.id).join(", ")}`,
    );
  }

  const column = /^[0-9a-f-]{36}$/i.test(target) ? "id" : "slug";
  const update: Database["public"]["Tables"]["workspaces"]["Update"] = {
    plan_id: plan.id,
  };
  if (overridesJson !== undefined) {
    const overrides = JSON.parse(overridesJson) as unknown;
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
      throw new Error("Overrides must be a JSON object");
    }
    update.entitlement_overrides = overrides as Json;
  }
  const { data, error } = await admin
    .from("workspaces")
    .update(update)
    .eq(column, target)
    .select("id, name, plan_id, entitlement_overrides");
  if (error) throw error;
  if (!data?.length) throw new Error(`No workspace with ${column} "${target}"`);
  const [workspace] = data;
  await admin.from("audit_logs").insert({
    workspace_id: workspace.id,
    actor_id: null,
    action: "plan.changed",
    metadata: { plan: plan.id, by: "admin script" },
  });
  console.log(`${workspace.name} (${workspace.id}) is now on ${plan.name}.`);
  console.log(resolveEntitlements(plan.entitlements, workspace.entitlement_overrides));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
