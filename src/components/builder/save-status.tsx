import { Loader2, Check, AlertTriangle, RotateCcw } from "lucide-react";

export type SaveState = "idle" | "saving" | "saved" | "error" | "stale";

export function SaveStatus({ state }: { state: SaveState }) {
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
