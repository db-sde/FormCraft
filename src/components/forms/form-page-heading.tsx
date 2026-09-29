import Link from "next/link";
import { ChevronRight } from "lucide-react";

/** "Forms › <title>" — the way back to the list from any form page. */
export function FormPageHeading({ title }: { title: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Link
        href="/dashboard"
        className="text-muted-foreground hover:text-foreground shrink-0 text-lg tracking-tight"
      >
        Forms
      </Link>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight">{title}</h1>
    </div>
  );
}
