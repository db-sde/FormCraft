import { ENTITLEMENT_DEFAULTS, type Entitlements, type Feature } from "./entitlements";

/**
 * The plans (pricing doc "FormCraft Pricing Plans & Unit Economics",
 * 26 Nov 2026): what each includes and costs. The database's `plans`
 * rows are seeded from these values (migration 77) and a unit test keeps
 * them equal; staff can still change a plan through an approved request,
 * which is why the app reads the database, not this file, at run time.
 *
 * Prices are US dollars per month. `annual` is the per-month price when
 * paid yearly.
 */
export const PUBLIC_PLAN_IDS = ["free", "starter", "pro", "business"] as const;
export type PublicPlanId = (typeof PUBLIC_PLAN_IDS)[number];
/** Enterprise is for custom contracts only (never listed). */
export type PlanId = PublicPlanId | "enterprise";

export const PLAN_PRICES: Record<PublicPlanId, { monthly: number; annual: number }> = {
  free: { monthly: 0, annual: 0 },
  starter: { monthly: 19, annual: 15 },
  pro: { monthly: 49, annual: 39 },
  business: { monthly: 89, annual: 69 },
};

/** Prices in Indian rupees for checkout through Razorpay (26 Nov 2026:
 * the US dollar prices at about ₹85, rounded). Staff can change them in
 * the database like the dollar prices. */
export const PLAN_PRICES_INR: Record<PublicPlanId, { monthly: number; annual: number }> =
  {
    free: { monthly: 0, annual: 0 },
    starter: { monthly: 1_599, annual: 1_299 },
    pro: { monthly: 4_199, annual: 3_299 },
    business: { monthly: 7_599, annual: 5_899 },
  };

export const PLAN_NAMES: Record<PlanId, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Pro",
  business: "Business",
  enterprise: "Enterprise",
};

export const PLAN_TAGLINES: Record<PublicPlanId, string> = {
  free: "Individuals, students, testing",
  starter: "Creators, freelancers, small businesses",
  pro: "Growing teams, marketers, agencies",
  business: "Larger teams, IT-managed companies",
};

const STARTER_FEATURES: Feature[] = [
  "remove_branding",
  "custom_fonts",
  "custom_seo",
  "email_templates",
  "confirmation_emails",
  "tracking_pixels",
  "calendar_sync",
  "business_apps",
  "partial_responses",
  "advanced_analytics",
  "pdf_documents",
  "ai_form_tools",
  "folders",
];

const PRO_FEATURES: Feature[] = [
  ...STARTER_FEATURES,
  "advanced_pixels",
  "team_hosts",
  "crm",
  "ai_insights",
  "advanced_reports",
  "response_workflow",
  "submission_editing",
  "team_notifications",
  "block_library",
  "advanced_logic",
  "data_lookups",
  "dynamic_themes",
  "embed_controls",
  "ab_testing",
  "email_otp",
  "multiple_workspaces",
  "granular_permissions",
];

const BUSINESS_FEATURES: Feature[] = [
  ...PRO_FEATURES,
  "audit_log",
  "auto_deletion",
  "sso",
  "scim",
];

function plan(features: Feature[], limits: Partial<Entitlements>): Entitlements {
  const result = { ...ENTITLEMENT_DEFAULTS, ...limits } as Record<string, unknown>;
  for (const f of features) result[f] = true;
  return result as Entitlements;
}

export const PLAN_ENTITLEMENTS: Record<PlanId, Entitlements> = {
  free: { ...ENTITLEMENT_DEFAULTS },
  starter: plan(STARTER_FEATURES, {
    responses_per_month: 10_000,
    members: 3,
    upload_mb: 50,
    storage_mb: 10_000,
    custom_domains: 1,
    ai_credits_per_month: 100,
    emails_per_month: 2_000,
    address_lookups_per_month: 500,
    recording_seconds: 180,
    booking_types: null,
    api_requests_per_minute: 150,
    api_burst: 1_000,
    api_requests_per_day: 50_000,
    api_keys: 5,
  }),
  pro: plan(PRO_FEATURES, {
    responses_per_month: 25_000,
    members: 10,
    upload_mb: 100,
    storage_mb: 50_000,
    custom_domains: 3,
    ai_credits_per_month: 1_000,
    emails_per_month: 10_000,
    address_lookups_per_month: 2_000,
    recording_seconds: 600,
    booking_types: null,
    api_requests_per_minute: 300,
    api_burst: 10_000,
    api_requests_per_day: 250_000,
    api_keys: 25,
  }),
  business: plan(BUSINESS_FEATURES, {
    responses_per_month: 50_000,
    members: null,
    upload_mb: 500,
    storage_mb: 200_000,
    custom_domains: null,
    ai_credits_per_month: 2_000,
    emails_per_month: 25_000,
    address_lookups_per_month: 2_500,
    recording_seconds: 600,
    booking_types: null,
    api_requests_per_minute: 1_000,
    api_burst: 50_000,
    api_requests_per_day: null,
    api_keys: null,
  }),
  // Custom contracts: Business, with limits set per deal by overrides.
  enterprise: plan(BUSINESS_FEATURES, {
    responses_per_month: null,
    members: null,
    upload_mb: 500,
    storage_mb: null,
    custom_domains: null,
    ai_credits_per_month: 5_000,
    emails_per_month: 100_000,
    address_lookups_per_month: 10_000,
    recording_seconds: 600,
    booking_types: null,
    api_requests_per_minute: 1_000,
    api_burst: 50_000,
    api_requests_per_day: null,
    api_keys: null,
  }),
};

/** The cheapest public plan that includes a feature (for "Available on
 * Starter and up"). */
export function minimumPlanFor(feature: Feature): PublicPlanId {
  return PUBLIC_PLAN_IDS.find((id) => PLAN_ENTITLEMENTS[id][feature]) ?? "business";
}

/** "Available on Pro and up." */
export function upgradeHint(feature: Feature): string {
  const plan = minimumPlanFor(feature);
  return plan === "business"
    ? "Available on the Business plan."
    : `Available on ${PLAN_NAMES[plan]} and up.`;
}

/** The features to list, by the plan they start on (catalog.ts). "More
 * than one workspace" isn't listed: creating extra workspaces isn't built
 * yet (DECISIONS.md, 26 Nov 2026). */
export const FEATURE_GROUPS: { title: string; features: Feature[] }[] = [
  {
    title: "On every plan",
    features: [
      "payments",
      "multilingual",
      "scheduling",
      "slack",
      "api_access",
      "popup_embeds",
    ],
  },
  {
    title: "Starter and up",
    features: [
      "remove_branding",
      "custom_fonts",
      "custom_seo",
      "email_templates",
      "confirmation_emails",
      "partial_responses",
      "advanced_analytics",
      "pdf_documents",
      "ai_form_tools",
      "tracking_pixels",
      "business_apps",
      "calendar_sync",
      "folders",
    ],
  },
  {
    title: "Pro and up",
    features: [
      "ai_insights",
      "advanced_reports",
      "response_workflow",
      "submission_editing",
      "team_notifications",
      "block_library",
      "advanced_logic",
      "data_lookups",
      "dynamic_themes",
      "embed_controls",
      "ab_testing",
      "email_otp",
      "crm",
      "advanced_pixels",
      "team_hosts",
      "granular_permissions",
    ],
  },
  { title: "Business", features: ["audit_log", "auto_deletion", "sso", "scim"] },
];
