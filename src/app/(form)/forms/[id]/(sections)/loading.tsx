import { Skeleton } from "@/components/ui/skeleton";

/** A form section page loading inside the app frame. */
export default function FormSectionLoading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-56" />
      <div className="border-ink flex items-end justify-between gap-4 border-b-[1.5px] pb-3.5">
        <Skeleton className="h-11 w-72" />
        <Skeleton className="hidden h-10 w-80 lg:block" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-lg" />
    </div>
  );
}
