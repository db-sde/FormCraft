import type { Metadata } from "next";
import { aiConfigured } from "@/domains/ai/config";
import Link from "next/link";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import {
  AccountSettings,
  WorkspaceSettings,
} from "@/components/dashboard/account-settings";
import { cn } from "cn";
import { PlanUsage } from "@/components/dashboard/plan-usage";
import { TeamSettings } from "@/components/dashboard/team-settings";
import { canAdmin, listTeam } from "@/domains/workspaces";
import { dnsInstructions, listDomains } from "@/domains/domains";
import { listFormsForWorkspace } from "@/domains/forms";
import { DomainSettings } from "@/components/dashboard/domain-settings";
import { ApiKeySettings } from "@/components/dashboard/api-key-settings";
import { ConnectionSettings } from "@/components/dashboard/connection-settings";
import { RetentionSettings } from "@/components/dashboard/retention-settings";
import { AuditLog } from "@/components/dashboard/audit-log";
import { listAuditLog } from "@/domains/audit";
import { listApiKeys } from "@/domains/api";
import { getUsage, getWorkspacePlan } from "@/domains/billing";
import { remainingRecoveryCodes, verifiedTotpFactor } from "@/domains/identity/mfa";
import { createAdminClient } from "@/lib/supabase/admin";
import { SecuritySettings } from "@/components/dashboard/security-settings";
import { getSsoSettings } from "@/domains/identity/sso";
import { notOnPlanMessage } from "@/domains/billing/entitlements";
import { PLAN_NAMES, PLAN_PRICES, PUBLIC_PLAN_IDS } from "@/domains/billing/catalog";
import { EmailBrandingSettings } from "@/components/dashboard/email-branding-settings";
import { readEmailBranding } from "@/domains/notifications/branding";

const TITLES = {
  account: "Account settings",
  workspace: "Workspace settings",
  members: "Members",
  plan: "Plan and usage",
  domains: "Domains",
  api: "API keys",
  connections: "Connections",
  audit: "Audit log",
  security: "Security",
};

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}): Promise<Metadata> {
  const { tab } = await searchParams;
  return { title: TITLES[tab as keyof typeof TITLES] ?? TITLES.account };
}

const TABS = [
  ["account", "Account"],
  ["workspace", "Workspace"],
  ["members", "Members"],
  ["domains", "Domains"],
  ["connections", "Connections"],
  ["api", "API"],
  ["plan", "Plan"],
  ["security", "Security"],
  ["audit", "Audit log"],
] as const;
type Tab = (typeof TABS)[number][0];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    before?: string;
    notice?: string;
    connect_error?: string;
  }>;
}) {
  const { tab: rawTab, before, notice, connect_error: connectError } = await searchParams;
  const tab: Tab = TABS.some(([key]) => key === rawTab) ? (rawTab as Tab) : "account";
  const { supabase, user, workspace } = await getCurrentWorkspace();
  const name = (user.user_metadata?.full_name as string | undefined) ?? "";

  const team =
    tab === "members"
      ? await Promise.all([
          listTeam(supabase, workspace.id),
          getWorkspacePlan(supabase, workspace.id),
        ])
      : null;

  const domainData =
    tab === "domains"
      ? await Promise.all([
          listDomains(supabase, workspace.id),
          listFormsForWorkspace(supabase, workspace.id),
          getWorkspacePlan(supabase, workspace.id),
        ])
      : null;

  const apiData =
    tab === "api" && canAdmin(workspace.role)
      ? await Promise.all([
          listApiKeys(supabase, workspace.id),
          getWorkspacePlan(supabase, workspace.id),
        ])
      : null;

  const connectionData =
    tab === "connections"
      ? await Promise.all([
          supabase.rpc("integration_status", { p_workspace_id: workspace.id }),
          getWorkspacePlan(supabase, workspace.id),
        ])
      : null;

  // The full audit log is a Business feature (pricing doc). On every plan,
  // what FormCraft support did to the workspace stays visible.
  const fullAudit =
    tab === "audit" &&
    (await getWorkspacePlan(supabase, workspace.id)).entitlements.audit_log;
  const auditRecords =
    tab === "audit" && canAdmin(workspace.role)
      ? (
          await listAuditLog(
            supabase,
            workspace.id,
            before ? Number(before) || undefined : undefined,
          )
        ).filter((r) => fullAudit || r.action.startsWith("support."))
      : null;
  const workspaceRow =
    tab === "workspace"
      ? (
          await supabase
            .from("workspaces")
            .select("response_retention_days, email_branding")
            .eq("id", workspace.id)
            .single()
        ).data
      : null;
  const retentionDays = workspaceRow?.response_retention_days ?? null;
  const workspaceEntitlements =
    tab === "workspace"
      ? (await getWorkspacePlan(supabase, workspace.id)).entitlements
      : null;

  const twoFactorEnabled = tab === "account" && !!(await verifiedTotpFactor(supabase));
  const twoFactor = {
    enabled: twoFactorEnabled,
    remaining: twoFactorEnabled
      ? await remainingRecoveryCodes(createAdminClient(), user.id)
      : 0,
  };

  const securityData =
    tab === "security" && canAdmin(workspace.role)
      ? await Promise.all([
          getSsoSettings(supabase, workspace.id),
          supabase.rpc("scim_status", { p_workspace_id: workspace.id }),
          getWorkspacePlan(supabase, workspace.id),
        ])
      : null;

  const planData =
    tab === "plan"
      ? await Promise.all([
          getWorkspacePlan(supabase, workspace.id),
          getUsage(supabase, workspace.id),
        ])
      : null;

  return (
    <div className="flex flex-col gap-[26px]">
      <h1 className="font-heading text-[38px] leading-none font-bold tracking-[-0.03em] sm:text-[56px] sm:tracking-[-0.035em]">
        Settings
      </h1>
      <nav
        aria-label="Settings sections"
        className="border-border flex gap-7 overflow-x-auto border-b-[1.5px] text-[15px] whitespace-nowrap"
      >
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={key === "account" ? "/settings" : `/settings?tab=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "fc-focus -mb-[1.5px] rounded-xs py-2",
              tab === key
                ? "font-bold shadow-[inset_0_-3px_0_var(--primary)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {connectError && (
        <p
          role="alert"
          className="rounded-lg border-[1.5px] border-[var(--alert-error-border)] bg-[var(--alert-error-bg)] p-3 text-sm text-[var(--alert-error-fg)]"
        >
          {connectError === "expired"
            ? "That app connection took too long, or was finished in another browser, so nothing was connected. Start it again from where you began: a form's Integrations page, or Bookings for your calendar."
            : "That app couldn't be connected. Please try again."}
        </p>
      )}
      {tab === "account" && notice === "two_factor_reset" && (
        <p
          role="status"
          className="border-ink rounded-lg border-[1.5px] bg-[var(--chip-draft-bg)] p-3 text-sm text-[var(--chip-draft-fg)]"
        >
          You used a recovery code, so two-factor authentication is now off. Set it up
          again below to keep your account protected.
        </p>
      )}
      {tab === "account" && (
        <AccountSettings name={name} email={user.email ?? ""} twoFactor={twoFactor} />
      )}

      {tab === "workspace" && (
        <WorkspaceSettings
          workspaceId={workspace.id}
          name={workspace.name}
          isOwner={workspace.role === "owner"}
        />
      )}
      {tab === "workspace" && workspaceEntitlements && (
        <EmailBrandingSettings
          workspaceId={workspace.id}
          initial={readEmailBranding(workspaceRow?.email_branding)}
          allowed={workspaceEntitlements.email_templates}
          isAdmin={canAdmin(workspace.role)}
        />
      )}
      {tab === "workspace" && (
        <RetentionSettings days={retentionDays} isAdmin={canAdmin(workspace.role)} />
      )}
      {tab === "security" &&
        (securityData ? (
          <SecuritySettings
            sso={securityData[0]}
            ssoAllowed={securityData[2].entitlements.sso}
            scim={
              securityData[1].data?.[0]
                ? {
                    prefix: securityData[1].data[0].prefix,
                    createdAt: securityData[1].data[0].created_at,
                    lastUsedAt: securityData[1].data[0].last_used_at,
                  }
                : null
            }
            scimAllowed={securityData[2].entitlements.scim}
            appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
            supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            Only the owner and admins can see security settings.
          </p>
        ))}
      {tab === "audit" && auditRecords && !fullAudit && (
        <p className="text-muted-foreground text-sm">
          {notOnPlanMessage("audit_log")} Changes made by FormCraft support are always
          shown here.
        </p>
      )}
      {tab === "audit" &&
        (auditRecords ? (
          <AuditLog
            records={auditRecords}
            olderHref={
              auditRecords.length === 50
                ? `/settings?tab=audit&before=${auditRecords[auditRecords.length - 1].id}`
                : null
            }
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            Only owners and admins can see the audit log.
          </p>
        ))}

      {planData && (
        <PlanUsage
          plan={planData[0]}
          usage={planData[1]}
          aiAvailable={aiConfigured()}
          upgradeOptions={
            canAdmin(workspace.role) &&
            PUBLIC_PLAN_IDS.includes(planData[0].planId as never)
              ? PUBLIC_PLAN_IDS.slice(
                  PUBLIC_PLAN_IDS.indexOf(planData[0].planId as never) + 1,
                )
                  .filter((id) => id !== "free")
                  .map((id) => ({
                    id,
                    name: PLAN_NAMES[id],
                    monthly: PLAN_PRICES[id].monthly,
                    annual: PLAN_PRICES[id].annual,
                  }))
              : []
          }
        />
      )}

      {connectionData && (
        <ConnectionSettings
          stripe={connectionData[0].data?.find((c) => c.provider === "stripe") ?? null}
          hubspot={connectionData[0].data?.find((c) => c.provider === "hubspot") ?? null}
          razorpay={
            connectionData[0].data?.find((c) => c.provider === "razorpay") ?? null
          }
          payments={connectionData[1].entitlements.payments}
          crm={connectionData[1].entitlements.business_apps}
          isAdmin={canAdmin(workspace.role)}
          stripeWebhookUrl={`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/payments/stripe/${workspace.id}`}
          razorpayWebhookUrl={`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/payments/razorpay/${workspace.id}`}
        />
      )}

      {tab === "api" && (
        <ApiKeySettings
          keys={apiData?.[0] ?? []}
          allowed={apiData?.[1].entitlements.api_access ?? false}
          isAdmin={canAdmin(workspace.role)}
          appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
        />
      )}

      {domainData && (
        <DomainSettings
          domains={domainData[0].map((d) => ({
            id: d.id,
            hostname: d.hostname,
            status: d.status,
            defaultFormId: d.defaultFormId,
            lastError: d.lastError,
            dns: dnsInstructions(d),
          }))}
          forms={domainData[1].map((f) => ({ id: f.id, title: f.title }))}
          isAdmin={canAdmin(workspace.role)}
          limit={domainData[2].entitlements.custom_domains}
          autoConnect={Boolean(
            process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID,
          )}
        />
      )}

      {team && (
        <TeamSettings
          members={team[0].members}
          invitations={team[0].invitations}
          currentUserId={user.id}
          myRole={workspace.role}
          seatLimit={team[1].entitlements.members}
        />
      )}
    </div>
  );
}
