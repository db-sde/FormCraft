import type { Metadata } from "next";
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
import { getUsage, getWorkspacePlan } from "@/domains/billing";

const TITLES = {
  account: "Account settings",
  workspace: "Workspace settings",
  members: "Members",
  plan: "Plan and usage",
  domains: "Domains",
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
  ["plan", "Plan"],
] as const;
type Tab = (typeof TABS)[number][0];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: rawTab } = await searchParams;
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
        className="border-border flex gap-7 border-b-[1.5px] text-[15px]"
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

      {tab === "account" && <AccountSettings name={name} email={user.email ?? ""} />}

      {tab === "workspace" && (
        <WorkspaceSettings
          workspaceId={workspace.id}
          name={workspace.name}
          isOwner={workspace.role === "owner"}
        />
      )}

      {planData && <PlanUsage plan={planData[0]} usage={planData[1]} />}

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
