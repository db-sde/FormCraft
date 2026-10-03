import { Check, Minus } from "lucide-react";
import {
  featureName,
  usageWarnings,
  type Entitlements,
  type Feature,
  type Usage,
  type WorkspacePlan,
} from "@/domains/billing";
import { SettingsSection } from "@/components/dashboard/account-settings";
import { cn } from "cn";

const FEATURES: Feature[] = [
  "remove_branding",
  "custom_fonts",
  "confirmation_emails",
  "popup_embeds",
  "tracking_pixels",
  "multilingual",
  "scheduling",
  "slack",
  "crm",
  "payments",
  "api_access",
  "ab_testing",
  "sso",
  "scim",
];

function Meter({
  label,
  used,
  limit,
  unit = "",
}: {
  label: string;
  used: number;
  limit: number | null;
  unit?: string;
}) {
  const percent = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const over = limit !== null && used > limit;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex justify-between gap-3 text-[13.5px]">
        <span>{label}</span>
        <b className={cn("tabular-nums", over && "text-destructive")}>
          {used.toLocaleString()}
          {unit} / {limit === null ? "Unlimited" : `${limit.toLocaleString()}${unit}`}
        </b>
      </div>
      {limit !== null && (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={used}
          className="bg-muted h-2.5 overflow-hidden rounded-full"
        >
          <div
            className={cn("h-full", over ? "bg-destructive" : "bg-primary")}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </li>
  );
}

/** Settings → Plan (PRD §7–8): what the workspace's plan includes and
 * what it has used this month. Plans are changed by an admin for now
 * (no checkout); see DECISIONS.md. */
export function PlanUsage({ plan, usage }: { plan: WorkspacePlan; usage: Usage }) {
  const e: Entitlements = plan.entitlements;
  const warnings = usageWarnings(usage, e);
  const month = new Date(`${usage.periodStart}T00:00:00Z`).toLocaleString("en", {
    month: "long",
    timeZone: "UTC",
  });
  return (
    <>
      <SettingsSection
        title="Plan"
        description="What this workspace can use. To change plans, contact us."
      >
        <p className="font-heading text-[28px] leading-none font-bold">{plan.planName}</p>
        {warnings.map((w) => (
          <p
            key={w.metric}
            role="status"
            className="rounded-sm border-[1.5px] border-[var(--alert-error-border)] bg-[var(--alert-error-bg)] px-3 py-2.5 text-[13.5px] text-[var(--alert-error-fg)]"
          >
            {w.message}
          </p>
        ))}
      </SettingsSection>
      <SettingsSection title={`Usage in ${month}`} description="Resets on the 1st (UTC).">
        <ul className="flex flex-col gap-4">
          <Meter
            label="Completed responses"
            used={usage.completedResponses}
            limit={e.responses_per_month}
          />
          <Meter
            label="AI credits"
            used={usage.aiCredits}
            limit={e.ai_credits_per_month}
          />
          <Meter label="Members" used={usage.members} limit={e.members} />
          <Meter
            label="File storage"
            used={usage.storageMb}
            limit={e.storage_mb}
            unit=" MB"
          />
        </ul>
        <p className="text-muted-foreground text-[12.5px]">
          Going over a response limit never loses a submission: every response is still
          saved and delivered.
        </p>
      </SettingsSection>
      <SettingsSection title="Included" last>
        <ul className="grid gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-2">
          {FEATURES.map((f) => (
            <li
              key={f}
              className={cn("flex items-center gap-2", !e[f] && "text-muted-foreground")}
            >
              {e[f] ? (
                <Check
                  className="size-4 text-[var(--chip-live-dot)]"
                  aria-label="Included"
                />
              ) : (
                <Minus className="size-4" aria-label="Not included" />
              )}
              {featureName(f)}
            </li>
          ))}
          <li className="flex items-center gap-2">
            <Check className="size-4 text-[var(--chip-live-dot)]" aria-label="Included" />
            Files up to {e.upload_mb === null ? "any size" : `${e.upload_mb} MB`}
          </li>
          <li
            className={cn(
              "flex items-center gap-2",
              e.custom_domains === 0 && "text-muted-foreground",
            )}
          >
            {e.custom_domains === 0 ? (
              <Minus className="size-4" aria-label="Not included" />
            ) : (
              <Check
                className="size-4 text-[var(--chip-live-dot)]"
                aria-label="Included"
              />
            )}
            {e.custom_domains === null
              ? "Unlimited custom domains"
              : `${e.custom_domains} custom domain${e.custom_domains === 1 ? "" : "s"}`}
          </li>
        </ul>
      </SettingsSection>
    </>
  );
}
