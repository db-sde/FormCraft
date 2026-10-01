import Link from "next/link";
import { cn } from "cn";

/** Stat card (Part 1 §3): caps label, a big Space Grotesk number, a
 * one-line hint. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs font-bold tracking-[0.08em] uppercase">
          {label}
        </span>
        {Icon && <Icon className="text-muted-foreground size-4" />}
      </div>
      <div className="font-heading text-[34px] leading-none font-bold tracking-[-0.02em] tabular-nums">
        {value}
      </div>
      {hint && <div className="text-muted-foreground text-[12.5px]">{hint}</div>}
    </>
  );
  const classes = cn(
    "flex flex-col gap-2 rounded-lg border-[1.5px] border-ink bg-card p-4",
    href &&
      "fc-focus transition-[transform,box-shadow] hover:-translate-x-px hover:-translate-y-px hover:shadow-raised",
    className,
  );
  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}
