import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  featureName,
  featureVerb,
  MINIMUM_PLAN_HINT,
  type Entitlements,
  type Feature,
} from "./entitlements";
import { PLAN_ENTITLEMENTS } from "./catalog";

/** One thing in a form that its workspace's plan doesn't allow. */
export type PlanIssue = {
  /** The entitlement it needs, when it's a feature. */
  feature?: Feature;
  /** What the form uses, in words ("AI follow-up questions"). */
  label: string;
  verb: "isn't" | "aren't";
  /** Which plan allows it ("Available on Starter and up."). */
  hint: string;
};

/**
 * Paid features a form carries in its own schema (pricing doc). They're
 * checked when the form is published, so a form can't go live using a
 * feature its workspace's plan doesn't include. A form published before
 * a downgrade keeps working as published until it's published again.
 */
export function planFeaturesUsed(schema: FormSchemaV1): Feature[] {
  return [
    ...new Set(
      featureUses(schema)
        .map((u) => u.feature)
        .filter((f): f is Feature => !!f),
    ),
  ];
}

type Use = { feature: Feature; label?: string; verb?: "isn't" | "aren't" };

function featureUses(schema: FormSchemaV1): Use[] {
  const uses: Use[] = [];
  if (schema.pools?.length) uses.push({ feature: "advanced_logic" });
  if (schema.questions.some((q) => (q as { profileKey?: string }).profileKey)) {
    uses.push({ feature: "advanced_logic" });
  }
  if (
    schema.questions.some(
      (q) => q.type === "email" && (q.settings as { verify?: boolean }).verify,
    )
  ) {
    uses.push({ feature: "email_otp" });
  }
  if (schema.themeVariants?.length) uses.push({ feature: "dynamic_themes" });
  if (schema.variants?.length) uses.push({ feature: "ab_testing" });
  // Name only what's used (QA FC15-49).
  const theme = schema.theme as { customCss?: string; customFont?: unknown };
  if (theme.customCss?.trim()) {
    uses.push({ feature: "custom_fonts", label: "Custom CSS", verb: "isn't" });
  }
  if (theme.customFont) {
    uses.push({ feature: "custom_fonts", label: "Uploaded fonts", verb: "aren't" });
  }
  // AI follow-ups spend AI credits, which start on Starter (QA FC15-37).
  if (
    schema.questions.some(
      (q) =>
        q.type === "long_text" && (q.settings as { aiFollowUp?: boolean }).aiFollowUp,
    )
  ) {
    uses.push({
      feature: "ai_form_tools",
      label: "AI follow-up questions",
      verb: "aren't",
    });
  }
  return uses;
}

function minutes(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} seconds`;
}

/** The smallest plan whose recordings are at least this long. */
function recordingHint(seconds: number): string {
  for (const plan of ["starter", "pro"] as const) {
    const allowed = PLAN_ENTITLEMENTS[plan].recording_seconds;
    if (allowed === null || allowed >= seconds) {
      return `Available on ${plan === "starter" ? "Starter" : "Pro"} and up.`;
    }
  }
  return "Shorten it to fit your plan.";
}

/** Everything in this form the plan doesn't allow, in a stable order. */
export function planIssues(
  schema: FormSchemaV1,
  entitlements: Entitlements,
): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const seen = new Set<string>();
  for (const use of featureUses(schema)) {
    if (entitlements[use.feature]) continue;
    const label = use.label ?? featureName(use.feature);
    if (seen.has(label)) continue;
    seen.add(label);
    issues.push({
      feature: use.feature,
      label,
      verb: use.verb ?? featureVerb(use.feature),
      hint: MINIMUM_PLAN_HINT[use.feature],
    });
  }
  // Recordings longer than the plan allows (QA FC15-38).
  const cap = entitlements.recording_seconds;
  if (cap !== null) {
    const longest = Math.max(
      0,
      ...schema.questions
        .filter((q) => q.type === "media")
        .map((q) => (q.settings as { maxSeconds?: number }).maxSeconds ?? 60),
    );
    if (longest > cap) {
      issues.push({
        label: `Video and audio answers longer than ${minutes(cap)}`,
        verb: "aren't",
        hint: recordingHint(longest),
      });
    }
  }
  return issues;
}

/** One sentence naming what isn't on the plan, or null. */
export function planIssuesMessage(issues: PlanIssue[], ending: string): string | null {
  if (issues.length === 0) return null;
  const names = issues.map((i) => i.label);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const verb = issues.length === 1 ? issues[0].verb : "aren't";
  const hints = [...new Set(issues.map((i) => i.hint).filter(Boolean))].join(" ");
  return `This form uses ${list}, which ${verb} included in your plan. ${hints} ${ending}`
    .replace(/\s+/g, " ")
    .trim();
}

/** What stops this form publishing on this plan, or null. */
export function publishBlockedBy(
  schema: FormSchemaV1,
  entitlements: Entitlements,
): string | null {
  const issues = planIssues(schema, entitlements);
  return planIssuesMessage(
    issues,
    `Remove ${issues.length === 1 ? "it" : "them"} or upgrade to publish.`,
  );
}

/** The same check for a saved draft: a warning, never a refusal, so
 * nothing being built is lost (QA run 15: check on save as well). */
export function draftPlanWarning(
  schema: FormSchemaV1,
  entitlements: Entitlements,
): string | null {
  const issues = planIssues(schema, entitlements);
  return planIssuesMessage(
    issues,
    `You can keep editing, but ${issues.length === 1 ? "it" : "they"} must be removed, or the plan upgraded, before you publish.`,
  );
}
