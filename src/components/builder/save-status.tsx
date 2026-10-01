import { Check, CircleAlert, MonitorSmartphone, RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "cn";

export type SaveState = "idle" | "saving" | "saved" | "error" | "stale" | "invalid";

const PILL =
  "flex h-7 shrink-0 items-center gap-1.5 rounded-full border-[1.5px] px-2.5 text-[12.5px] font-semibold whitespace-nowrap";

/** The builder's save-state pill (Part 4 header). */
export function SaveStatus({
  state,
  problem,
  onProblemClick,
}: {
  state: SaveState;
  /** Why the draft can't be saved, when state is "invalid". */
  problem?: string | null;
  /** Jumps to the item the problem belongs to. */
  onProblemClick?: () => void;
}) {
  switch (state) {
    case "saving":
      return (
        <span
          role="status"
          className={cn(PILL, "text-muted-foreground border-transparent")}
        >
          <span className="size-[11px] animate-spin rounded-full border-2 border-current border-t-transparent" />
          Saving…
        </span>
      );
    case "idle":
    case "saved":
      return (
        <span
          role="status"
          className={cn(PILL, "text-muted-foreground border-transparent")}
        >
          <Check className="size-[13px]" /> Saved
        </span>
      );
    case "error":
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="status"
              tabIndex={0}
              className={cn(
                PILL,
                "fc-focus border-warning bg-[var(--chip-draft-bg)] text-[var(--chip-draft-fg)]",
              )}
            >
              <RefreshCw className="size-[13px]" /> Couldn&apos;t save. Retrying…
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-[250px]">
            We&apos;ll keep trying every few seconds. Your changes are safe in this tab,
            so don&apos;t close it yet.
          </TooltipContent>
        </Tooltip>
      );
    case "invalid":
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="status"
              onClick={onProblemClick}
              className={cn(
                PILL,
                "fc-focus border-destructive bg-[var(--alert-error-bg)] text-[var(--alert-error-fg)]",
              )}
            >
              <CircleAlert className="size-[13px]" /> Not saved
              <span className="sr-only">: {problem}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[250px]">
            {problem} Click to jump to it. We&apos;ll save as soon as it&apos;s fixed.
          </TooltipContent>
        </Tooltip>
      );
    case "stale":
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="status"
              tabIndex={0}
              className={cn(
                PILL,
                "fc-focus border-destructive bg-[var(--alert-error-bg)] text-[var(--alert-error-fg)]",
              )}
            >
              <MonitorSmartphone className="size-[13px]" /> Edited elsewhere. Reload to
              continue.
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-[250px]">
            Someone (maybe you, in another tab) changed this form. Reload to get the
            latest version. Edits here are paused.
          </TooltipContent>
        </Tooltip>
      );
  }
}
