import { Skeleton } from "@/components/ui/skeleton";

/** Shown under the dashboard header while a page's server data loads,
 * so navigation gives immediate feedback instead of appearing frozen. */
export default function DashboardLoading() {
  return (
    <div
      className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10"
      aria-busy="true"
      aria-label="Loading"
    >
      <Skeleton className="mb-2 h-7 w-40" />
      <Skeleton className="mb-8 h-4 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
