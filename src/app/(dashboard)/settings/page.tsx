import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import {
  AccountSettings,
  SettingsSection,
  WorkspaceSettings,
} from "@/components/dashboard/account-settings";
import { cn } from "cn";

export const metadata: Metadata = { title: "Settings" };

const TABS = [
  ["account", "Account"],
  ["workspace", "Workspace"],
  ["members", "Members"],
] as const;
type Tab = (typeof TABS)[number][0];

const ROLE_LABEL: Record<string, string> = { owner: "Owner", editor: "Editor" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: rawTab } = await searchParams;
  const tab: Tab = TABS.some(([key]) => key === rawTab) ? (rawTab as Tab) : "account";
  const { supabase, user, workspace } = await getCurrentWorkspace();
  const name = (user.user_metadata?.full_name as string | undefined) ?? "";

  let members: { userId: string; role: string; name: string; email: string }[] = [];
  if (tab === "members") {
    const { data } = await supabase
      .from("workspace_members")
      .select("user_id, role, profiles(full_name, email)")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: true });
    members = (data ?? []).map((m) => {
      const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      return {
        userId: m.user_id,
        role: m.role,
        name: profile?.full_name ?? "",
        email: profile?.email ?? "",
      };
    });
  }

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

      {tab === "members" && (
        <SettingsSection
          title="Members"
          description={
            <>
              <b className="text-foreground">Owners</b> manage the workspace and its
              members. <b className="text-foreground">Editors</b> build, publish and see
              responses.
            </>
          }
          wide
          last
        >
          <ul className="border-ink bg-card overflow-hidden rounded-lg border-[1.5px]">
            {members.map((m) => {
              const isYou = m.userId === user.id;
              const display = isYou ? `${name || "You"} (you)` : m.name || "Teammate";
              const initials = (display.trim()[0] ?? "?").toUpperCase();
              return (
                <li
                  key={m.userId}
                  className="border-border flex items-center gap-3 border-b px-3.5 py-3 last:border-b-0"
                >
                  <span
                    aria-hidden
                    className="border-ink bg-primary text-primary-foreground grid size-[34px] shrink-0 place-items-center rounded-full border-[1.5px] text-xs font-bold"
                  >
                    {initials}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
                    <b className="truncate text-sm">{display}</b>
                    <span className="text-muted-foreground truncate text-[12.5px]">
                      {isYou ? user.email : m.email}
                    </span>
                  </span>
                  <span className="text-[13.5px] font-semibold">
                    {ROLE_LABEL[m.role] ?? m.role}
                  </span>
                </li>
              );
            })}
          </ul>
        </SettingsSection>
      )}
    </div>
  );
}
