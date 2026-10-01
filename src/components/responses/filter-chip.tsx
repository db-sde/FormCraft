"use client";

import Link from "next/link";
import { Check, ChevronDown, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "cn";

export type FilterOption = { label: string; href: string; selected?: boolean };
export type FilterGroup = { label: string; options: FilterOption[] };

/**
 * A response filter as a pill (Part 5): dashed while unset, amber with
 * an × once set. Every choice is a link, so filters live in the URL and
 * survive reloads, sharing and the back button.
 */
export function FilterChip({
  icon,
  label,
  active,
  clearHref,
  clearLabel,
  options,
  groups,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  /** Where the × goes (the same page without this filter). */
  clearHref?: string;
  clearLabel?: string;
  options?: FilterOption[];
  /** Two-level menus, e.g. question → answer. */
  groups?: FilterGroup[];
}) {
  return (
    <span
      className={cn(
        "flex h-[34px] items-center rounded-full border-[1.5px] text-[13.5px] font-semibold",
        active
          ? "border-ink bg-accent text-foreground"
          : "border-subtle-foreground text-muted-foreground border-dashed",
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "fc-focus hover:text-foreground flex h-full items-center gap-1.5 rounded-full pl-3 [&_svg]:size-3.5",
            active && clearHref ? "pr-1.5" : "pr-3",
          )}
        >
          {icon}
          <span className="max-w-[220px] truncate">{label}</span>
          {!active && <ChevronDown className="opacity-60" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-[360px] min-w-[200px] overflow-y-auto"
        >
          {options?.map((o) => (
            <DropdownMenuItem key={o.href} asChild>
              <Link href={o.href} scroll={false}>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.selected && <Check className="ml-2" />}
              </Link>
            </DropdownMenuItem>
          ))}
          {groups?.map((g) => (
            <DropdownMenuSub key={g.label}>
              <DropdownMenuSubTrigger className="max-w-[280px]">
                <span className="truncate">{g.label}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[320px] min-w-[180px] overflow-y-auto">
                {g.options.map((o) => (
                  <DropdownMenuItem key={o.href} asChild>
                    <Link href={o.href} scroll={false}>
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {o.selected && <Check className="ml-2" />}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {active && clearHref && (
        <Link
          href={clearHref}
          scroll={false}
          aria-label={clearLabel ?? `Clear ${label}`}
          className="fc-focus hover:bg-hover-wash-strong mr-1.5 grid size-5 place-items-center rounded-full"
        >
          <X className="size-3" />
        </Link>
      )}
    </span>
  );
}
