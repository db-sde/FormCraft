"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LocalTime } from "@/components/local-time";
import { decideAction, type ActionResult } from "../../actions";

export type ChangeRequest = {
  id: string;
  action: string;
  target_email: string | null;
  target_type: string;
  target_id: string;
  payload: Record<string, unknown>;
  reason: string;
  requested_by_name: string | null;
  requested_at: string;
  expires_at: string;
  emergency: boolean;
  mine: boolean;
};

const ACTION_LABEL: Record<string, string> = {
  "staff.add": "Add staff",
  "staff.set_role": "Change staff role",
  "staff.disable": "Disable staff",
  "workspace.status": "Change account status",
  "workspace.plan": "Change workspace plan",
  "plan.update": "Change plan entitlements",
};

export function RequestList({
  requests,
  mode,
  isOwner,
  canApply = false,
}: {
  requests: ChangeRequest[];
  mode: "pending" | "approved";
  isOwner: boolean;
  canApply?: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();
  const [emergencyFor, setEmergencyFor] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const run = (
    id: string,
    decision: "approve" | "reject" | "apply" | "emergency",
    text?: string,
    action?: string,
  ) =>
    start(async () => {
      const result: ActionResult = await decideAction({
        id,
        decision,
        note: text,
        action,
      });
      if (result.ok) {
        toast.success("Done.");
        setEmergencyFor(null);
        setNote("");
        router.refresh();
      } else if (result.why === "step_up_required") {
        router.push(`/admin/two-factor?next=${encodeURIComponent(path)}`);
      } else if (result.why === "session_idle" || result.why === "session_expired") {
        router.push("/admin/login?expired=1");
      } else {
        toast.error(result.error);
      }
    });

  if (requests.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing here.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {requests.map((r) => (
        <li
          key={r.id}
          className="border-border flex flex-col gap-2 rounded-lg border-[1.5px] p-3.5"
        >
          <div className="flex flex-wrap items-baseline gap-2">
            <b>{ACTION_LABEL[r.action] ?? r.action}</b>
            <span className="text-sm">
              {r.target_email ??
                (r.target_type === "workspace" ? (
                  <a className="underline" href={`/admin/customers/${r.target_id}`}>
                    workspace {r.target_id.slice(0, 8)}
                  </a>
                ) : (
                  r.target_id
                ))}
            </span>
            {Object.keys(r.payload).length > 0 && (
              <code className="text-muted-foreground text-xs">
                {JSON.stringify(r.payload)}
              </code>
            )}
            {r.emergency && (
              <span className="rounded-full bg-[var(--alert-error-bg)] px-2 text-xs font-semibold text-[var(--alert-error-fg)]">
                emergency
              </span>
            )}
          </div>
          <p className="text-sm">“{r.reason}”</p>
          <p className="text-muted-foreground text-xs">
            Asked by {r.mine ? "you" : (r.requested_by_name ?? "a teammate")}{" "}
            <LocalTime iso={r.requested_at} /> · expires <LocalTime iso={r.expires_at} />
          </p>
          <div className="flex flex-wrap gap-2">
            {mode === "pending" && !r.mine && (
              <>
                <Button size="sm" disabled={pending} onClick={() => run(r.id, "approve")}>
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => run(r.id, "reject")}
                >
                  Reject
                </Button>
              </>
            )}
            {mode === "pending" && r.mine && isOwner && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setEmergencyFor(r.id)}
              >
                Emergency approve…
              </Button>
            )}
            {mode === "approved" && canApply && (
              <Button
                size="sm"
                disabled={pending}
                onClick={() => run(r.id, "apply", undefined, r.action)}
              >
                Apply now
              </Button>
            )}
          </div>
          {emergencyFor === r.id && (
            <div className="flex flex-col gap-2 rounded-sm bg-[var(--alert-error-bg)] p-3">
              <p className="text-sm">
                Only when no one else can approve. Every owner is told, and it&apos;s
                marked as an emergency in the audit trail.
              </p>
              <Textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why this can't wait for a second person"
                aria-label="Emergency reason"
              />
              <Button
                size="sm"
                variant="destructive"
                disabled={pending || note.trim().length < 10}
                onClick={() => run(r.id, "emergency", note)}
              >
                Approve as emergency
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
