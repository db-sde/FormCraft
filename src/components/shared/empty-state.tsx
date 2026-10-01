import { cn } from "cn";

/** "Nothing here yet" (Part 1 §3): a dashed ink frame, a tilted icon
 * tile, a short title, and copy that invites the next step. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  className,
  tint = "var(--accent)",
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  /** Background of the icon tile. */
  tint?: string;
}) {
  return (
    <div
      className={cn(
        "border-ink bg-card flex flex-col items-center gap-2.5 rounded-lg border-[1.5px] border-dashed px-7 py-10 text-center",
        className,
      )}
    >
      <span
        className="border-ink shadow-card mb-1 grid size-[52px] -rotate-6 place-items-center rounded-[12px] border-[1.5px] text-[#2b2118]"
        style={{ background: tint }}
      >
        <Icon className="size-6 stroke-[1.75]" />
      </span>
      <p className="font-heading text-[19px] font-bold">{title}</p>
      {description && (
        <p className="text-muted-foreground max-w-[340px] text-sm leading-normal text-pretty">
          {description}
        </p>
      )}
      {actions && (
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-3">
          {actions}
        </div>
      )}
    </div>
  );
}
