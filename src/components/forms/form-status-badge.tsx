import type { PublishState } from "@/domains/forms";
import { StatusChip } from "@/components/ui/status-chip";

/** Live / Unpublished changes / Draft / Unpublished, wherever a form's
 * publish state is shown. */
export function FormStatusBadge({
  state,
  hasChanges = false,
  className,
}: {
  state: PublishState;
  /** Live, but the draft has edits that aren't published yet. */
  hasChanges?: boolean;
  className?: string;
}) {
  if (state === "live" && hasChanges) {
    return (
      <StatusChip tone="changes" className={className}>
        Unpublished changes
      </StatusChip>
    );
  }
  if (state === "live") {
    return (
      <StatusChip tone="live" className={className}>
        Live
      </StatusChip>
    );
  }
  if (state === "unpublished") {
    return (
      <StatusChip tone="pending" className={className}>
        Unpublished
      </StatusChip>
    );
  }
  return (
    <StatusChip tone="draft" className={className}>
      Draft
    </StatusChip>
  );
}
