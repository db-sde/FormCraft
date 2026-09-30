import Link from "next/link";
import { cn } from "cn";

/** One number with its label (and optional hint / link). */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  href?: string;
}) {
  const body = (
    <>
      <div className="text-muted-foreground flex items-center justify-between gap-2 text-sm">
        {label}
        {Icon && <Icon className="size-4" />}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </div>
      {hint && <div className="text-muted-foreground mt-1 text-xs">{hint}</div>}
    </>
  );
  const className = cn(
    "bg-card rounded-xl border p-4 shadow-xs",
    href && "hover:border-primary/40 transition-colors",
  );
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
