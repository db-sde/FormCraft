import { isReviewStatus, REVIEW_STATUS_LABEL } from "@/domains/responses/review";
import { cn } from "cn";

const STYLE: Record<string, string> = {
  new: "bg-[var(--qt-text-bg)] text-[var(--qt-text-fg)]",
  in_progress: "bg-[var(--chip-draft-bg)] text-[var(--chip-draft-fg)]",
  done: "bg-[var(--chip-live-bg)] text-[var(--chip-live-fg)]",
};

/** A response's review status in the records view (F-03). */
export function ReviewChip({ status }: { status: string }) {
  const known = isReviewStatus(status) ? status : "new";
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-bold",
        STYLE[known],
      )}
    >
      {REVIEW_STATUS_LABEL[known]}
    </span>
  );
}
