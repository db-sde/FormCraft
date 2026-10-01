"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { useStoredValue } from "@/lib/hooks/use-stored-value";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Check,
  ChevronsUpDown,
  EllipsisVertical,
  LayoutGrid,
  LayoutTemplate,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { cn } from "cn";
import { Dialog } from "radix-ui";
import { createFormAction } from "@/app/(dashboard)/actions";
import { logOutAction } from "@/app/(auth)/actions";
import type { OnboardingStep } from "@/domains/workspaces";
import { SubmitButton } from "@/components/submit-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Brand } from "./brand";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutGrid;
  match: string[];
  count?: number;
};

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function useIsActive() {
  const pathname = usePathname();
  return (match: string[]) =>
    match.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Light / Dark / System, persisted by next-themes (Account settings has
 * the same control). */
function ThemeSegment() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const current = mounted ? (theme ?? "system") : "system";
  const options = [
    ["system", "Auto"],
    ["light", "Light"],
    ["dark", "Dark"],
  ] as const;
  return (
    <span
      role="radiogroup"
      aria-label="Theme"
      className="border-border flex gap-px rounded-sm border-[1.5px] p-0.5 text-[11.5px] font-semibold"
    >
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={current === value}
          onClick={(e) => {
            e.preventDefault();
            setTheme(value);
          }}
          className={cn(
            "fc-focus rounded-xs px-1.5 py-0.5",
            current === value
              ? "bg-secondary text-secondary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

const CHECKLIST_KEY = "fc-checklist-dismissed";

function GettingStarted({ steps }: { steps: OnboardingStep[] }) {
  // Hidden on the server pass so a dismissed card never flashes in.
  const [stored, store] = useStoredValue(CHECKLIST_KEY, "1");
  const dismissed = stored === "1";

  const done = steps.filter((s) => s.done).length;
  if (dismissed || done === steps.length) return null;
  const next = steps.findIndex((s) => !s.done);

  return (
    <div className="border-ink bg-background relative flex flex-col gap-2.5 rounded-lg border-[1.5px] border-dashed p-3.5">
      <div className="dark:text-primary text-[11px] leading-none font-bold tracking-[0.1em] text-[#9a6a0c] uppercase">
        Getting started · {done} of {steps.length}
      </div>
      <div className="font-heading text-base leading-[1.2] font-bold">
        Let&apos;s get your first responses in
      </div>
      <ol className="flex flex-col gap-1">
        {steps.map((step, i) => (
          <li key={step.id}>
            <Link
              href={step.href}
              className={cn(
                "fc-focus flex items-center gap-2 rounded-sm border-[1.5px] px-2 py-1.5",
                i === next
                  ? "border-ink bg-primary text-primary-foreground"
                  : "hover:bg-hover-wash border-transparent",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "border-ink grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px] text-[9px] font-bold",
                  step.done ? "bg-secondary text-secondary-foreground" : "bg-card",
                )}
              >
                {step.done ? <Check className="size-2.5 stroke-[3]" /> : null}
              </span>
              <span
                className={cn(
                  "text-[13px] font-semibold",
                  step.done && "text-muted-foreground line-through",
                )}
              >
                {step.label}
                {step.done && <span className="sr-only"> (done)</span>}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <button
        type="button"
        aria-label="Hide getting started"
        onClick={() => store("1")}
        className="fc-focus text-muted-foreground hover:bg-hover-wash absolute top-2 right-2 grid size-6 place-items-center rounded-xs"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function WorkspaceSwitcher({ name, memberCount }: { name: string; memberCount: number }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Workspace menu"
          className="fc-focus border-border bg-background aria-expanded:border-ink flex w-full items-center gap-2.5 rounded-sm border-[1.5px] px-2.5 py-2 text-left"
        >
          <span className="border-ink bg-primary font-heading text-primary-foreground grid size-[30px] shrink-0 place-items-center rounded-[8px] border-[1.5px] text-[13px] leading-none font-bold">
            {(name.trim()[0] ?? "W").toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-sm font-semibold">{name}</span>
            <span className="text-muted-foreground text-xs">
              {memberCount} member{memberCount === 1 ? "" : "s"}
            </span>
          </span>
          <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[260px]">
        <DropdownMenuLabel className="fc-caption pt-1.5 pb-1 text-[11px]">
          Workspaces
        </DropdownMenuLabel>
        <DropdownMenuItem className="bg-accent min-h-[42px]">
          <span className="border-ink bg-primary font-heading text-primary-foreground grid size-6 place-items-center rounded-[6px] border-[1.5px] text-[11px] font-bold">
            {(name.trim()[0] ?? "W").toUpperCase()}
          </span>
          <span className="flex-1 truncate font-semibold">{name}</span>
          <Check />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=workspace">
            <Settings /> Workspace settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=members">
            <UsersRound /> Members
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AccountMenu({ userName, userEmail }: { userName: string; userEmail: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="fc-focus hover:bg-hover-wash aria-expanded:bg-hover-wash flex w-full items-center gap-2.5 rounded-sm p-1.5 text-left"
        >
          <span className="border-ink bg-primary text-primary-foreground grid size-[34px] shrink-0 place-items-center rounded-full border-[1.5px] text-xs leading-none font-bold">
            {initials(userName || userEmail)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[13.5px] font-semibold">
              {userName || "Your account"}
            </span>
            <span className="text-muted-foreground truncate text-xs">{userEmail}</span>
          </span>
          <EllipsisVertical className="text-muted-foreground size-4 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[248px]">
        <div className="flex flex-col gap-0.5 px-2.5 py-2">
          <b className="truncate text-sm">{userName || "Your account"}</b>
          <span className="text-muted-foreground truncate text-[12.5px]">
            {userEmail}
          </span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <UserRound /> Account settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => e.preventDefault()}
          className="focus:bg-transparent"
        >
          <Moon />
          <span className="flex-1">Theme</span>
          <ThemeSegment />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={logOutAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut /> Log out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NewFormButton({ className }: { className?: string }) {
  return (
    <form action={createFormAction}>
      <SubmitButton
        className={cn("shadow-card h-11 w-full", className)}
        icon={<Plus />}
        pendingLabel="Creating…"
      >
        New form
      </SubmitButton>
    </form>
  );
}

function Sidebar({
  nav,
  workspaceName,
  memberCount,
  userName,
  userEmail,
  steps,
  showChecklist,
}: {
  nav: NavItem[];
  workspaceName: string;
  memberCount: number;
  userName: string;
  userEmail: string;
  steps: OnboardingStep[];
  showChecklist: boolean;
}) {
  const isActive = useIsActive();
  return (
    <div className="flex h-full flex-col gap-[18px] px-4 py-[22px]">
      <div className="px-1.5">
        <Brand href="/dashboard" />
      </div>
      <WorkspaceSwitcher name={workspaceName} memberCount={memberCount} />
      <NewFormButton />
      <nav aria-label="Main" className="flex flex-col gap-1">
        {nav.map((item) => {
          const active = isActive(item.match);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "fc-focus flex h-10 items-center gap-3 rounded-sm px-3 text-[14.5px] transition-colors",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold"
                  : "text-muted-foreground hover:bg-hover-wash hover:text-foreground font-medium",
              )}
            >
              <Icon className="size-[18px] shrink-0 stroke-[1.75]" />
              <span className="flex-1">{item.label}</span>
              {item.count !== undefined && <span className="text-xs">{item.count}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="flex-1" />
      {showChecklist && <GettingStarted steps={steps} />}
      <AccountMenu userName={userName} userEmail={userEmail} />
    </div>
  );
}

/**
 * The creator workspace frame (Part 3): a 256px sidebar on desktop
 * (logo, workspace, New form, nav, getting-started card, account menu)
 * and, on phones, a top bar whose menu opens a bottom sheet.
 */
export function AppShell({
  workspaceName,
  memberCount,
  formCount,
  steps,
  userName,
  userEmail,
  children,
}: {
  workspaceName: string;
  memberCount: number;
  formCount: number;
  steps: OnboardingStep[];
  userName: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const isActive = useIsActive();
  const pathname = usePathname();

  const nav: NavItem[] = [
    {
      href: "/dashboard",
      label: "Forms",
      icon: LayoutGrid,
      // A form's own pages live under /forms/*.
      match: ["/dashboard", "/forms"],
      count: formCount,
    },
    { href: "/leads", label: "Leads", icon: UsersRound, match: ["/leads"] },
    {
      href: "/templates",
      label: "Templates",
      icon: LayoutTemplate,
      match: ["/templates"],
    },
    { href: "/settings", label: "Settings", icon: Settings, match: ["/settings"] },
  ];
  // The checklist lives with the forms, not on templates or settings.
  const showChecklist =
    !pathname.startsWith("/templates") && !pathname.startsWith("/settings");

  return (
    <div className="bg-canvas flex min-h-dvh">
      <aside className="border-sidebar-border bg-sidebar sticky top-0 hidden h-dvh w-64 shrink-0 overflow-y-auto border-r-[1.5px] md:block">
        <Sidebar
          nav={nav}
          workspaceName={workspaceName}
          memberCount={memberCount}
          userName={userName}
          userEmail={userEmail}
          steps={steps}
          showChecklist={showChecklist}
        />
      </aside>

      {/* Phones: a real modal bottom sheet, so Escape closes it, Tab
          stays inside it, and focus goes back to the menu button. */}
      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="bg-scrim data-open:animate-in data-open:fade-in-0 fixed inset-0 z-50 md:hidden" />
          <Dialog.Content
            className="border-ink bg-card data-open:animate-in data-open:slide-in-from-bottom-6 fixed inset-x-0 bottom-0 z-50 flex flex-col gap-1.5 rounded-t-[20px] border-t-[1.5px] px-4 pt-3 pb-7 outline-none md:hidden"
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              // There's no Dialog.Trigger (the button lives in the top
              // bar), so say where focus goes back to.
              event.preventDefault();
              menuButtonRef.current?.focus();
            }}
          >
            <Dialog.Title className="sr-only">Menu</Dialog.Title>
            <span
              aria-hidden
              className="bg-input mb-2.5 h-1 w-10 self-center rounded-full"
            />
            <div className="border-border bg-background mb-1.5 flex items-center gap-3 rounded-[8px] border-[1.5px] p-2.5">
              <span className="border-ink bg-primary text-primary-foreground grid size-9 shrink-0 place-items-center rounded-full border-[1.5px] text-xs font-bold">
                {initials(userName || userEmail)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-[14.5px]">{workspaceName}</b>
                <span className="text-muted-foreground truncate text-[12.5px]">
                  {userEmail}
                </span>
              </span>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close menu"
                  className="fc-focus hover:bg-hover-wash grid size-9 place-items-center rounded-sm"
                >
                  <X className="size-4" />
                </button>
              </Dialog.Close>
            </div>
            {nav.map((item) => {
              const active = isActive(item.match);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "fc-focus flex h-[52px] items-center gap-3.5 rounded-[8px] px-3.5 text-base",
                    active
                      ? "bg-secondary text-secondary-foreground font-semibold"
                      : "hover:bg-hover-wash",
                  )}
                >
                  <Icon className="size-5 stroke-[1.75]" />
                  {item.label}
                </Link>
              );
            })}
            <form action={logOutAction} className="border-border border-t-[1.5px]">
              <button
                type="submit"
                className="fc-focus hover:bg-hover-wash flex h-[52px] w-full items-center gap-3.5 rounded-[8px] px-3.5 text-base"
              >
                <LogOut className="size-5 stroke-[1.75]" />
                Log out
              </button>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-ink bg-card sticky top-0 z-30 flex items-center gap-2.5 border-b-[1.5px] px-4 py-2.5 md:hidden">
          <Brand href="/dashboard" size="sm" />
          <div className="flex-1" />
          <Link
            href="/dashboard?focus=search"
            aria-label="Search forms"
            className="fc-focus hover:bg-hover-wash grid size-11 place-items-center rounded-sm"
          >
            <Search className="size-5" />
          </Link>
          <button
            ref={menuButtonRef}
            type="button"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
            className="fc-focus border-ink grid size-11 place-items-center rounded-sm border-[1.5px]"
          >
            <Menu className="size-5" />
          </button>
        </header>
        <main className="flex-1">
          <div className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-10 sm:py-10">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
