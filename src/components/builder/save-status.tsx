import { Loader2, Check, AlertTriangle, RotateCcw, CircleAlert } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type SaveState = "idle" | "saving" | "saved" | "error" | "stale" | "invalid";

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
        <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <Loader2 className="size-3.5 animate-spin" /> Saving…
        </span>
      );
    case "saved":
      return (
        <span className="flex items-center gap-1.5 text-sm text-emerald-600">
          <Check className="size-3.5" /> Saved
        </span>
      );
    case "error":
      return (
        <span className="text-destructive flex items-center gap-1.5 text-sm">
          <AlertTriangle className="size-3.5" /> Couldn&apos;t save — retrying
        </span>
      );
    case "invalid":
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="status"
              onClick={onProblemClick}
              className="text-destructive flex items-center gap-1.5 text-sm hover:underline"
            >
              <CircleAlert className="size-3.5" /> Not saved
              <span className="sr-only">: {problem}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{problem}</TooltipContent>
        </Tooltip>
      );
    case "stale":
      return (
        <span className="flex items-center gap-1.5 text-sm text-amber-600">
          <RotateCcw className="size-3.5" /> Edited elsewhere — reload to continue
        </span>
      );
    default:
      return null;
  }
}
