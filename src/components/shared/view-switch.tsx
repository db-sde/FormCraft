import Link from "next/link";
import { cn } from "cn";

/** Link-based segmented control, e.g. Completed | Incomplete. */
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
    <nav aria-label={label} className="bg-muted inline-flex rounded-lg p-1">
      {options.map((option) => {
        const isActive = option.id === active;
        return (
          <Link
            key={option.id}
            href={option.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs tabular-nums",
                  isActive ? "bg-accent text-accent-foreground" : "bg-background/60",
                )}
              >
                {option.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
