import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  featureName,
  MINIMUM_PLAN_HINT,
  type Entitlements,
  type Feature,
} from "./entitlements";

/**
 * Paid features a form carries in its own schema (pricing doc). They're
 * checked when the form is published, so a form can't go live using a
 * feature its workspace's plan doesn't include. A form published before
 * a downgrade keeps working as published until it's published again.
 */
export function planFeaturesUsed(schema: FormSchemaV1): Feature[] {
  const used = new Set<Feature>();
  if (schema.pools?.length) used.add("advanced_logic");
  if (schema.questions.some((q) => (q as { profileKey?: string }).profileKey)) {
    used.add("advanced_logic");
  }
  if (
    schema.questions.some(
      (q) => q.type === "email" && (q.settings as { verify?: boolean }).verify,
    )
  ) {
    used.add("email_otp");
  }
  if (schema.themeVariants?.length) used.add("dynamic_themes");
  if (schema.variants?.length) used.add("ab_testing");
  if ((schema.theme as { customCss?: string }).customCss?.trim())
    used.add("custom_fonts");
  return [...used];
}

/** What stops this form publishing on this plan, or null. */
export function publishBlockedBy(
  schema: FormSchemaV1,
  entitlements: Entitlements,
): string | null {
  const missing = planFeaturesUsed(schema).filter((f) => !entitlements[f]);
  if (missing.length === 0) return null;
  const names = missing.map((f) => featureName(f));
  const hint = MINIMUM_PLAN_HINT[missing[missing.length - 1]];
  return `This form uses ${names.join(", ")}, which ${missing.length === 1 ? "isn't" : "aren't"} included in your plan. ${hint} Remove ${missing.length === 1 ? "it" : "them"} or upgrade to publish.`;
}
