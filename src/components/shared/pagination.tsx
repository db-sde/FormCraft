import Link from "next/link";
import { Button } from "@/components/ui/button";

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: string;
}) {
  // A disabled <Link> still navigates — render an inert button instead.
  return disabled ? (
    <Button variant="outline" size="sm" disabled>
      {children}
    </Button>
  ) : (
    <Button asChild variant="outline" size="sm">
      <Link href={href}>{children}</Link>
    </Button>
  );
}

/** Previous / Next for a paged list. `hrefFor(page)` builds each URL. */
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
    <div className="mt-4 flex items-center justify-between text-sm">
      <span className="text-muted-foreground">
        Page {page} of {pageCount}
      </span>
      <div className="flex gap-2">
        <PageLink href={hrefFor(page - 1)} disabled={page <= 1}>
          Previous
        </PageLink>
        <PageLink href={hrefFor(page + 1)} disabled={page >= pageCount}>
          Next
        </PageLink>
      </div>
    </div>
  );
}
