"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SystemPage } from "@/components/shared/system-page";

/** Route-level error boundary: an unexpected server/render error shows
 * a recoverable page instead of Next's unbranded crash screen. */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <SystemPage
      glyph="!"
      title="Something went wrong"
      body="That's on us, not you. Your work is saved, since we save every change as you go. Try again, and if it keeps happening, let us know."
      actions={
        <>
          <Button onClick={reset} className="shadow-card h-11 px-[18px]">
            Try again
          </Button>
          <Button asChild variant="outline" className="h-11 px-[18px] font-semibold">
            <Link href="/dashboard">Go to your forms</Link>
          </Button>
        </>
      }
      code={error.digest ? `Error ID: ${error.digest}` : undefined}
    />
  );
}
