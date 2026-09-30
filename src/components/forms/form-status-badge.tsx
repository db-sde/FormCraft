import type { PublishState } from "@/domains/forms";
import { cn } from "cn";

const LABEL: Record<PublishState, string> = {
  live: "Live",
  draft: "Draft",
  unpublished: "Unpublished",
};

/** Live / Draft / Unpublished pill used wherever a form's publish state
 * is shown. */
export function FormStatusBadge({
  state,
  className,
}: {
  state: PublishState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        state === "live"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : state === "unpublished"
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "bg-muted text-muted-foreground border-transparent",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          state === "live"
            ? "bg-emerald-500"
            : state === "unpublished"
              ? "bg-amber-500"
              : "bg-slate-400",
        )}
      />
      {LABEL[state]}
    </span>
  );
}
