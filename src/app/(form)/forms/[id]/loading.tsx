import { Skeleton } from "@/components/ui/skeleton";

/** Any page inside a form: its header, then content placeholders. */
export default function FormPageLoading() {
  return (
    <div className="flex min-h-dvh flex-col" aria-busy="true" aria-label="Loading form">
      <div className="bg-background flex h-14 shrink-0 items-center gap-3 border-b px-3">
        <Skeleton className="size-8 rounded-md" />
        <Skeleton className="h-5 w-48" />
        <Skeleton className="mx-auto hidden h-8 w-96 lg:block" />
        <Skeleton className="ml-auto h-8 w-28" />
      </div>
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-8">
        <Skeleton className="mb-6 h-8 w-56" />
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}
