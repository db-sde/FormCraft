import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * The one place features ask "is this allowed?" (PRD §7). Values come
 * from the workspace's plan row plus its overrides — data, not code —
 * so changing what a plan includes never needs a deploy. Checked on the
 * server; the UI only reflects the answer.
 *
 * Numbers are limits (null = unlimited); booleans are features. These
 * defaults are the Free plan (pricing doc, 26 Nov 2026); the other plans
 * are in catalog.ts, and a unit test keeps the database's seed equal.
 */
export const ENTITLEMENT_DEFAULTS = {
  // Limits and monthly quotas.
  /** Fair-use review level, not a cap: responses are never refused. */
  responses_per_month: 5000 as number | null,
  members: 1 as number | null,
  upload_mb: 10 as number | null,
  storage_mb: 1000 as number | null,
  custom_domains: 0 as number | null,
  ai_credits_per_month: 0 as number | null,
  emails_per_month: 500 as number | null,
  address_lookups_per_month: 0 as number | null,
  recording_seconds: 60 as number | null,
  booking_types: 1 as number | null,
  api_requests_per_minute: 60 as number | null,
  /** The API's token bucket size: how many requests may come at once. */
  api_burst: 100 as number | null,
  api_requests_per_day: 5000 as number | null,
  api_keys: 2 as number | null,
  // Features on every plan.
  popup_embeds: true,
  multilingual: true,
  scheduling: true,
  slack: true,
  payments: true,
  api_access: true,
  // Starter and up.
  remove_branding: false,
  custom_fonts: false,
  custom_seo: false,
  email_templates: false,
  confirmation_emails: false,
  tracking_pixels: false,
  calendar_sync: false,
  business_apps: false,
  partial_responses: false,
  advanced_analytics: false,
  pdf_documents: false,
  ai_form_tools: false,
  folders: false,
  // Pro and up.
  advanced_pixels: false,
  team_hosts: false,
  crm: false,
  ai_insights: false,
  advanced_reports: false,
  response_workflow: false,
  submission_editing: false,
  team_notifications: false,
  block_library: false,
  advanced_logic: false,
  data_lookups: false,
  dynamic_themes: false,
  embed_controls: false,
  ab_testing: false,
  email_otp: false,
  multiple_workspaces: false,
  granular_permissions: false,
  // Business.
  audit_log: false,
  auto_deletion: false,
  sso: false,
  scim: false,
};

export type Entitlements = typeof ENTITLEMENT_DEFAULTS;
export type Feature = {
  [K in keyof Entitlements]: Entitlements[K] extends boolean ? K : never;
}[keyof Entitlements];
export type Limit = Exclude<keyof Entitlements, Feature>;

export type WorkspacePlan = {
  planId: string;
  planName: string;
  entitlements: Entitlements;
};

/** Plan values over the defaults, overrides over both; values of the
 * wrong type are ignored rather than trusted. */
export function resolveEntitlements(
  planValues: unknown,
  overrides: unknown,
): Entitlements {
  const result = { ...ENTITLEMENT_DEFAULTS } as Record<string, unknown>;
  for (const source of [planValues, overrides]) {
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      if (!(key in ENTITLEMENT_DEFAULTS)) continue;
      const fallback = ENTITLEMENT_DEFAULTS[key as keyof Entitlements];
      if (
        typeof fallback === "boolean"
          ? typeof value === "boolean"
          : value === null || (typeof value === "number" && value >= 0)
      ) {
        result[key] = value;
      }
    }
  }
  return result as Entitlements;
}

export async function getWorkspacePlan(
  supabase: Client,
  workspaceId: string,
): Promise<WorkspacePlan> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("plan_id, entitlement_overrides, plans(name, entitlements)")
    .eq("id", workspaceId)
    .single();
  if (error) throw error;
  const plan = data.plans as { name: string; entitlements: unknown } | null;
  return {
    planId: data.plan_id,
    planName: plan?.name ?? "Free",
    entitlements: resolveEntitlements(plan?.entitlements, data.entitlement_overrides),
  };
}

export function hasFeature(entitlements: Entitlements, feature: Feature): boolean {
  return entitlements[feature];
}

/** Whether `used + adding` stays within a limit (null = unlimited). */
export function withinLimit(
  entitlements: Entitlements,
  limit: Limit,
  used: number,
  adding = 1,
): boolean {
  const max = entitlements[limit];
  return max === null || used + adding <= max;
}

export class EntitlementError extends Error {
  constructor(
    readonly feature: keyof Entitlements,
    message: string,
  ) {
    super(message);
    this.name = "EntitlementError";
  }
}

const FEATURE_NAMES: Record<Feature, string> = {
  popup_embeds: "Popup and button embeds",
  multilingual: "Multiple languages",
  scheduling: "Bookings",
  slack: "Slack",
  payments: "Payments",
  api_access: "The API",
  remove_branding: "Removing the FormCraft badge",
  custom_fonts: "Custom CSS and uploaded fonts",
  custom_seo: "Custom link previews and search settings",
  email_templates: "Custom email templates",
  confirmation_emails: "Confirmation emails",
  tracking_pixels: "Google Analytics, Tag Manager and Meta pixels",
  calendar_sync: "Google Calendar sync",
  business_apps: "HubSpot, Mailchimp, Airtable, Notion and Google Drive",
  partial_responses: "Unfinished responses",
  advanced_analytics: "Drop-off, sources and score analytics",
  pdf_documents: "PDF documents",
  ai_form_tools: "AI form writing and editing",
  folders: "Folders",
  advanced_pixels: "LinkedIn and TikTok pixels",
  team_hosts: "Team booking hosts",
  crm: "Salesforce, Zoho CRM and Pipedrive",
  ai_insights: "AI response insights",
  advanced_reports: "Cross-tabs, leads and 360° reports",
  response_workflow: "Response status, assignees and comments",
  submission_editing: "Editing submitted answers",
  team_notifications: "Teammate email rules and digests",
  block_library: "The shared question-block library",
  advanced_logic: "Random groups, adaptive and progressive questions",
  data_lookups: "External data lookups",
  dynamic_themes: "Themes by link",
  embed_controls: "Embed allowlist and kiosk mode",
  ab_testing: "A/B tests",
  email_otp: "Email verification codes",
  multiple_workspaces: "More than one workspace",
  granular_permissions: "Granular permissions",
  audit_log: "The audit log",
  auto_deletion: "Automatic deletion of old responses",
  sso: "Single sign-on",
  scim: "SCIM provisioning",
};

/** Throws when the workspace's plan doesn't include a feature. */
export async function requireFeature(
  supabase: Client,
  workspaceId: string,
  feature: Feature,
): Promise<void> {
  const { entitlements } = await getWorkspacePlan(supabase, workspaceId);
  if (!entitlements[feature])
    throw new EntitlementError(feature, notOnPlanMessage(feature));
}

/** Null when the workspace's plan includes the feature; otherwise what to
 * tell the person (for server actions: `if (blocked) return …`). */
export async function planBlocks(
  supabase: Client,
  workspaceId: string,
  feature: Feature,
): Promise<string | null> {
  const { entitlements } = await getWorkspacePlan(supabase, workspaceId);
  return entitlements[feature] ? null : notOnPlanMessage(feature);
}

/** "A/B tests aren't included in your plan. Available on Pro and up." */
export function notOnPlanMessage(feature: Feature): string {
  return `${FEATURE_NAMES[feature]} ${FEATURE_NAMES[feature].endsWith("s") && !FEATURE_NAMES[feature].startsWith("The ") ? "aren't" : "isn't"} included in your plan. ${MINIMUM_PLAN_HINT[feature]}`;
}

/** Which plan a feature starts on, for the messages above (catalog.ts
 * decides; a unit test keeps this equal to it). */
export const MINIMUM_PLAN_HINT: Record<Feature, string> = {
  popup_embeds: "",
  multilingual: "",
  scheduling: "",
  slack: "",
  payments: "",
  api_access: "",
  remove_branding: "Available on Starter and up.",
  custom_fonts: "Available on Starter and up.",
  custom_seo: "Available on Starter and up.",
  email_templates: "Available on Starter and up.",
  confirmation_emails: "Available on Starter and up.",
  tracking_pixels: "Available on Starter and up.",
  calendar_sync: "Available on Starter and up.",
  business_apps: "Available on Starter and up.",
  partial_responses: "Available on Starter and up.",
  advanced_analytics: "Available on Starter and up.",
  pdf_documents: "Available on Starter and up.",
  ai_form_tools: "Available on Starter and up.",
  folders: "Available on Starter and up.",
  advanced_pixels: "Available on Pro and up.",
  team_hosts: "Available on Pro and up.",
  crm: "Available on Pro and up.",
  ai_insights: "Available on Pro and up.",
  advanced_reports: "Available on Pro and up.",
  response_workflow: "Available on Pro and up.",
  submission_editing: "Available on Pro and up.",
  team_notifications: "Available on Pro and up.",
  block_library: "Available on Pro and up.",
  advanced_logic: "Available on Pro and up.",
  data_lookups: "Available on Pro and up.",
  dynamic_themes: "Available on Pro and up.",
  embed_controls: "Available on Pro and up.",
  ab_testing: "Available on Pro and up.",
  email_otp: "Available on Pro and up.",
  multiple_workspaces: "Available on Pro and up.",
  granular_permissions: "Available on Pro and up.",
  audit_log: "Available on the Business plan.",
  auto_deletion: "Available on the Business plan.",
  sso: "Available on the Business plan.",
  scim: "Available on the Business plan.",
};

export function featureName(feature: Feature): string {
  return FEATURE_NAMES[feature];
}
