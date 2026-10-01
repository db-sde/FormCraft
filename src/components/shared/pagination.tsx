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
  summary,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
  /** Left-hand "Showing 1–25 of 248"; shown even on a single page. */
  summary?: React.ReactNode;
}) {
  if (summary) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{summary}</span>
        {pageCount > 1 && <Pager page={page} pageCount={pageCount} hrefFor={hrefFor} />}
      </div>
    );
  }
  if (pageCount <= 1) return null;
  return (
    <div className="mt-5 flex justify-center">
      <Pager page={page} pageCount={pageCount} hrefFor={hrefFor} />
    </div>
  );
}

function Pager({
  page,
  pageCount,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
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
