import Link from "next/link";
import { cn } from "cn";

/** Link-based segmented pills, e.g. Completed | Incomplete. */
export function ViewSwitch({
  options,
  active,
  label,
}: {
  options: { id: string; label: string; count?: number; href: string }[];
  active: string;
  label: string;
}) {
  return (
    <nav
      aria-label={label}
      className="border-border bg-card inline-flex gap-0.5 rounded-full border-[1.5px] p-[3px] text-[13.5px] font-semibold"
    >
      {options.map((option) => {
        const isActive = option.id === active;
        return (
          <Link
            key={option.id}
            href={option.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "fc-focus flex items-center gap-1.5 rounded-full px-3.5 py-1.5 transition-colors",
              isActive
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span className="tabular-nums">{option.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
