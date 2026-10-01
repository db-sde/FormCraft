import { cn } from "cn";

/** The title block at the top of every workspace page: an optional
 * eyebrow line, a big Space Grotesk title, and actions on the right. */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
  size = "default",
}: {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  /** "sm" = 30px titles on form-level pages. */
  size?: "default" | "sm";
}) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-muted-foreground mb-2 text-[13px] sm:text-[15px]">
            {eyebrow}
          </div>
        )}
        <h1
          className={cn(
            "font-heading font-bold",
            size === "sm"
              ? "text-[30px] leading-[1.05] tracking-[-0.03em]"
              : "text-[38px] leading-none tracking-[-0.03em] sm:text-[56px] sm:tracking-[-0.035em]",
          )}
        >
          {title}
        </h1>
        {description && (
          <p className="text-muted-foreground mt-2.5 max-w-2xl text-[15px]">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>
      )}
    </div>
  );
}
