import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * The one place features ask "is this allowed?" (PRD §7). Values come
 * from the workspace's plan row plus its overrides — data, not code —
 * so changing what a plan includes never needs a deploy. Checked on the
 * server; the UI only reflects the answer.
 *
 * Numbers are limits (null = unlimited); booleans are features.
 */
export const ENTITLEMENT_DEFAULTS = {
  responses_per_month: 1000 as number | null,
  members: 1 as number | null,
  upload_mb: 10 as number | null,
  storage_mb: 1000 as number | null,
  remove_branding: false,
  custom_domains: 0 as number | null,
  custom_fonts: false,
  confirmation_emails: false,
  popup_embeds: false,
  tracking_pixels: false,
  slack: false,
  crm: false,
  payments: false,
  scheduling: false,
  multilingual: false,
  ai_credits_per_month: 20 as number | null,
  api_access: false,
  ab_testing: false,
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
  remove_branding: "Removing the FormCraft badge",
  custom_fonts: "Custom fonts",
  confirmation_emails: "Confirmation emails",
  popup_embeds: "Popup and button embeds",
  tracking_pixels: "Analytics and ad pixels",
  slack: "Slack",
  crm: "CRM integrations",
  payments: "Payments",
  scheduling: "Scheduling",
  multilingual: "Multiple languages",
  api_access: "The API",
  ab_testing: "A/B tests",
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
  if (!entitlements[feature]) {
    throw new EntitlementError(
      feature,
      `${FEATURE_NAMES[feature]} isn't included in your plan.`,
    );
  }
}

export function featureName(feature: Feature): string {
  return FEATURE_NAMES[feature];
}
