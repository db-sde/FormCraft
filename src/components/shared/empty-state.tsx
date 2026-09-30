import { cn } from "cn";

/** A friendly "nothing here yet" block that says what to do next. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-card flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center",
        className,
      )}
    >
      <span className="bg-accent text-accent-foreground grid size-11 place-items-center rounded-full">
        <Icon className="size-5" />
      </span>
      <p className="font-medium">{title}</p>
      {description && (
        <p className="text-muted-foreground max-w-md text-sm">{description}</p>
      )}
      {actions && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
