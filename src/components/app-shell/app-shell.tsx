"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronsUpDown,
  FileText,
  LayoutTemplate,
  LogOut,
  Menu,
  Plus,
  Settings,
  UsersRound,
  X,
} from "lucide-react";
import { cn } from "cn";
import { createFormAction } from "@/app/(dashboard)/actions";
import { logOutAction } from "@/app/(auth)/actions";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Brand } from "./brand";

const NAV = [
  {
    href: "/dashboard",
    label: "Forms",
    icon: FileText,
    description: "Build and manage forms",
    // A form's own pages live under /forms/*.
    match: ["/dashboard", "/forms"],
  },
  {
    href: "/leads",
    label: "Leads",
    icon: UsersRound,
    description: "Contacts from your forms",
    match: ["/leads"],
  },
  {
    href: "/templates",
    label: "Templates",
    icon: LayoutTemplate,
    description: "Start from a ready-made form",
    match: ["/templates"],
  },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

function SidebarContent({
  workspaceName,
  userName,
  userEmail,
  onNavigate,
}: {
  workspaceName: string;
  userName: string;
  userEmail: string;
  /** Closes the mobile drawer after a link is followed. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <div className="px-2 pt-1">
        <Brand href="/dashboard" />
        <p className="text-muted-foreground mt-2 truncate text-xs" title={workspaceName}>
          {workspaceName}
        </p>
      </div>

      <form action={createFormAction}>
        <SubmitButton className="w-full" icon={<Plus />} pendingLabel="Creating…">
          New form
        </SubmitButton>
      </form>

      <nav aria-label="Main" className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = item.match.some(
            (p) => pathname === p || pathname.startsWith(`${p}/`),
          );
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account menu"
              className="hover:bg-sidebar-accent/60 flex w-full items-center gap-2.5 rounded-md p-2 text-left"
            >
              <span className="bg-primary/10 text-primary grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold">
                {initials(userName || userEmail)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {userName || "Your account"}
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  {userEmail}
                </span>
              </span>
              <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel className="truncate font-normal">
              <span className="text-muted-foreground block text-xs">Signed in as</span>
              <span className="block truncate">{userEmail}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings" onClick={onNavigate}>
                <Settings />
                Account settings
              </Link>
            </DropdownMenuItem>
            <form action={logOutAction}>
              <DropdownMenuItem asChild>
                <button type="submit" className="w-full">
                  <LogOut />
                  Log out
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/**
 * The creator workspace frame: a fixed sidebar on desktop (navigation,
 * "New form", account) and a top bar + slide-over drawer on mobile.
 */
export function AppShell({
  workspaceName,
  userName,
  userEmail,
  children,
}: {
  workspaceName: string;
  userName: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebar = (
    <SidebarContent
      workspaceName={workspaceName}
      userName={userName}
      userEmail={userEmail}
      onNavigate={() => setMobileOpen(false)}
    />
  );

  return (
    <div className="bg-canvas flex min-h-dvh">
      <aside className="bg-sidebar sticky top-0 hidden h-dvh w-60 shrink-0 border-r md:block">
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="bg-sidebar absolute inset-y-0 left-0 w-72 border-r shadow-xl">
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-3 right-3"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
            >
              <X />
            </Button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
          >
            <Menu />
          </Button>
          <Brand href="/dashboard" />
        </header>
        <main className="flex-1">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
