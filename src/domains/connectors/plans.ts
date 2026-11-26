import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getWorkspacePlan, type Feature } from "@/domains/billing/entitlements";

type Client = SupabaseClient<Database>;

/**
 * Which plan feature each app needs (pricing doc): small-business apps
 * from Starter, sales CRMs from Pro, Google Calendar sync from Starter.
 * Checked when connecting and again before every sync, so a downgrade
 * stops them.
 */
export const CONNECTOR_PLAN_FEATURE: Record<string, Feature> = {
  hubspot: "business_apps",
  mailchimp: "business_apps",
  airtable: "business_apps",
  notion: "business_apps",
  google_drive: "business_apps",
  salesforce: "crm",
  zoho: "crm",
  pipedrive: "crm",
  google_calendar: "calendar_sync",
};

export async function connectorAllowed(
  admin: Client,
  workspaceId: string,
  provider: string,
): Promise<boolean> {
  const feature = CONNECTOR_PLAN_FEATURE[provider];
  if (!feature) return true;
  return (await getWorkspacePlan(admin, workspaceId)).entitlements[feature];
}
