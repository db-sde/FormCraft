import * as React from "react";
import { cn } from "cn";

/**
 * Status chips (Part 1 §1): pill, 1.5px border, 6px dot. Every status in
 * the app uses one of these tones so the colour always means the same
 * thing — green finished/live, amber draft/partial, orange unpublished
 * changes, blue active right now, grey queued, red failed.
 */
export type ChipTone =
  | "live"
  | "draft"
  | "changes"
  | "progress"
  | "pending"
  | "failed"
  | "exhausted"
  | "default";

const TONE: Record<ChipTone, string> = {
  live: "bg-[var(--chip-live-bg)] text-[var(--chip-live-fg)] [--dot:var(--chip-live-dot)] border-ink",
  draft:
    "bg-[var(--chip-draft-bg)] text-[var(--chip-draft-fg)] [--dot:var(--chip-draft-dot)] border-ink",
  changes:
    "bg-[var(--chip-changes-bg)] text-[var(--chip-changes-fg)] [--dot:var(--chip-changes-dot)] border-ink",
  progress:
    "bg-[var(--chip-progress-bg)] text-[var(--chip-progress-fg)] [--dot:var(--chip-progress-dot)] border-ink",
  pending:
    "bg-[var(--chip-pending-bg)] text-[var(--chip-pending-fg)] [--dot:var(--chip-pending-dot)] border-ink",
  failed:
    "bg-[var(--chip-failed-bg)] text-[var(--chip-failed-fg)] [--dot:var(--chip-failed-dot)] border-ink",
  exhausted:
    "bg-[var(--chip-exhausted-bg)] text-[var(--chip-exhausted-fg)] [--dot:var(--chip-exhausted-dot)] border-ink",
  default: "bg-card text-muted-foreground [--dot:var(--input)] border-input",
};

export function StatusChip({
  tone,
  children,
  className,
  dot = true,
  size = "default",
  ...props
}: React.ComponentProps<"span"> & {
  tone: ChipTone;
  dot?: boolean;
  size?: "default" | "sm";
}) {
  return (
    <span
      data-slot="status-chip"
      data-tone={tone}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border-[1.5px] font-bold whitespace-nowrap uppercase",
        size === "sm"
          ? "px-2 py-0.5 text-[10.5px] leading-[1.3] tracking-[0.06em]"
          : "px-[9px] py-[3px] text-[11px] leading-[1.3] tracking-[0.05em]",
        TONE[tone],
        className,
      )}
      {...props}
    >
      {dot && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-(--dot)" />}
      {children}
    </span>
  );
}
