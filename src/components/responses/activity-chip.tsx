import { ACTIVITY_LABEL, type ResponseActivity } from "@/domains/responses/activity";
import { StatusChip, type ChipTone } from "@/components/ui/status-chip";

const TONE: Record<ResponseActivity, ChipTone> = {
  completed: "live",
  in_progress: "progress",
  abandoned: "draft",
};

/** Completed (green) / In progress (blue, active in the last 30 min) /
 * Abandoned (amber) — the same chip everywhere a response appears. */
export function ActivityChip({
  activity,
  size = "sm",
}: {
  activity: ResponseActivity;
  size?: "sm" | "default";
}) {
  return (
    <StatusChip tone={TONE[activity]} size={size}>
      {ACTIVITY_LABEL[activity]}
    </StatusChip>
  );
}
