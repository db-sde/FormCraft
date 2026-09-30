import { cn } from "cn";

/** Live / Draft pill used wherever a form's publish state is shown. */
export function FormStatusBadge({
  live,
  className,
}: {
  live: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        live
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "bg-muted text-muted-foreground border-transparent",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", live ? "bg-emerald-500" : "bg-slate-400")}
      />
      {live ? "Live" : "Draft"}
    </span>
  );
}
