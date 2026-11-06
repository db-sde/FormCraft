import { Sprout } from "lucide-react";
import { cn } from "cn";
import { NOT_SET_UP_BODY, notSetUpTitle } from "@/lib/not-set-up";

/**
 * Shown where a feature would be when this server hasn't switched it on
 * yet. `children` adds what still works meanwhile.
 */
export function NotSetUpYet({
  feature,
  plural = false,
  children,
  className,
}: {
  /** What isn't on yet, e.g. "Google Sheets". */
  feature: string;
  /** The feature's name is plural ("Apps are almost here"). */
  plural?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={cn(
        "border-border flex gap-3 rounded-sm border-[1.5px] border-dashed bg-[var(--qt-other-bg)]/40 px-3.5 py-3 text-sm",
        className,
      )}
    >
      <span className="border-ink grid size-8 shrink-0 place-items-center rounded-full border-[1.5px] bg-[var(--qt-other-bg)] text-[var(--qt-other-fg)]">
        <Sprout className="size-4" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <b>{notSetUpTitle(feature, plural)}</b>
        <p className="text-muted-foreground leading-[1.5]">{NOT_SET_UP_BODY}</p>
        {children ? (
          <p className="text-muted-foreground leading-[1.5]">{children}</p>
        ) : null}
      </div>
    </div>
  );
}
