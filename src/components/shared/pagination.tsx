import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "cn";

const base =
  "fc-focus inline-flex h-9 items-center gap-1.5 rounded-sm border-[1.5px] px-3 text-sm font-semibold";

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  // A disabled <Link> still navigates — render an inert span instead.
  return disabled ? (
    <span
      aria-disabled
      className={cn(base, "border-disabled-border text-subtle-foreground border-dashed")}
    >
      {children}
    </span>
  ) : (
    <Link href={href} className={cn(base, "border-ink bg-card hover:bg-accent")}>
      {children}
    </Link>
  );
}

/** Previous · "Page 1 of 12" · Next (Part 1 §3 Navigation). */
export function Pagination({
  page,
  pageCount,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="mt-5 flex items-center justify-center gap-3 text-sm">
      <PageLink href={hrefFor(page - 1)} disabled={page <= 1}>
        <ArrowLeft className="size-3.5" />
        Previous
      </PageLink>
      <span className="text-muted-foreground">
        Page <b className="text-foreground">{page}</b> of {pageCount}
      </span>
      <PageLink href={hrefFor(page + 1)} disabled={page >= pageCount}>
        Next
        <ArrowRight className="size-3.5" />
      </PageLink>
    </div>
  );
}
