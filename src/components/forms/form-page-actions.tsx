import Link from "next/link";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublishButton } from "./publish-button";

/** Next to the section tabs: Share once the form is live, Publish before. */
export function FormPageActions({ formId, isLive }: { formId: string; isLive: boolean }) {
  if (!isLive) return <PublishButton formId={formId} />;
  return (
    <Button asChild variant="outline" className="h-[38px]">
      <Link href={`/forms/${formId}/share`}>
        <Share2 /> Share
      </Link>
    </Button>
  );
}
