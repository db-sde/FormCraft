import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SystemPage } from "@/components/shared/system-page";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <SystemPage
      glyph="?"
      title="Page not found"
      body="We looked everywhere, including under the sofa. The page may have moved, or the link might be mistyped."
      actions={
        <Button asChild className="shadow-card h-11 px-[18px]">
          <Link href="/dashboard">Go to your forms</Link>
        </Button>
      }
    />
  );
}
