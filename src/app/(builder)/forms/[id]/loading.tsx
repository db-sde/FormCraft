import { Skeleton } from "@/components/ui/skeleton";

export default function BuilderLoading() {
  return (
    <div className="flex h-screen flex-col" aria-busy="true" aria-label="Loading form">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-3">
        <Skeleton className="size-8 rounded-md" />
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-72 shrink-0 flex-col gap-2 border-r p-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
        <div className="flex-1 p-10">
          <Skeleton className="mb-4 h-4 w-24" />
          <Skeleton className="mb-3 h-8 w-2/3" />
          <Skeleton className="h-10 w-full max-w-md" />
        </div>
      </div>
    </div>
  );
}
