import { StatusChip, type ChipTone } from "@/components/ui/status-chip";

type Status = "pending" | "succeeded" | "failed" | "exhausted";

const TONE: Record<Status, ChipTone> = {
  succeeded: "live",
  pending: "pending",
  failed: "failed",
  exhausted: "exhausted",
};

const LABEL: Record<Status, string> = {
  succeeded: "Succeeded",
  pending: "Pending",
  failed: "Failed",
  exhausted: "Exhausted",
};

/** One line of a webhook delivery log or a Sheets sync log. */
export function DeliveryRow({
  when,
  detail,
  error,
  status,
}: {
  when: React.ReactNode;
  detail?: string;
  error?: string | null;
  status: Status;
}) {
  return (
    <div className="border-muted flex min-h-8 flex-wrap items-center gap-x-3 border-t py-1 text-[13.5px]">
      <span className="w-[150px] shrink-0">{when}</span>
      <span
        className="text-muted-foreground min-w-0 flex-1 truncate"
        title={error ?? undefined}
      >
        {[detail, error].filter(Boolean).join(" · ")}
      </span>
      <span className="min-w-[90px]">
        <StatusChip tone={TONE[status]} size="sm">
          {LABEL[status]}
        </StatusChip>
      </span>
    </div>
  );
}
