"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { requestWorkspaceChangeAction } from "../../../actions";

const field = "flex flex-col gap-1";
const select = "border-input bg-field h-9 rounded-sm border-[1.5px] px-2 text-sm";

/** Ask for a status or plan change; someone else approves it. */
export function WorkspaceChangeForms(props: {
  workspaceId: string;
  currentStatus: string;
  currentPlan: string;
  currentOverrides: Record<string, unknown>;
  plans: { id: string; name: string }[];
  canStatus: boolean;
  canPlan: boolean;
}) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(props.currentStatus);
  const [message, setMessage] = useState("");
  const [statusReason, setStatusReason] = useState("");
  const [plan, setPlan] = useState(props.currentPlan);
  const [overrides, setOverrides] = useState(
    Object.keys(props.currentOverrides).length
      ? JSON.stringify(props.currentOverrides)
      : "",
  );
  const [planReason, setPlanReason] = useState("");

  const send = (input: Record<string, unknown>, reset: () => void) =>
    start(async () => {
      const result = await requestWorkspaceChangeAction({
        workspaceId: props.workspaceId,
        ...input,
      });
      if (result.ok) {
        toast.success("Requested. Someone else approves it on Approvals.");
        reset();
      } else toast.error(result.error);
    });

  return (
    <section className="grid gap-4 sm:grid-cols-2">
      {props.canStatus && (
        <form
          className="border-border flex flex-col gap-3 rounded-lg border-[1.5px] p-4"
          onSubmit={(e) => {
            e.preventDefault();
            send(
              {
                action: "workspace.status",
                status,
                message: message || undefined,
                reason: statusReason,
              },
              () => setStatusReason(""),
            );
          }}
        >
          <h2 className="font-semibold">Account status</h2>
          <div className={field}>
            <label htmlFor="ws-status" className="text-sm font-semibold">
              New status
            </label>
            <select
              id="ws-status"
              className={select}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="active">Active</option>
              <option value="restricted">Restricted (no new or published forms)</option>
              <option value="suspended">Suspended (read-only, forms closed)</option>
            </select>
          </div>
          <div className={field}>
            <label htmlFor="ws-message" className="text-sm font-semibold">
              Message the customer sees (optional)
            </label>
            <Textarea
              id="ws-message"
              rows={2}
              maxLength={500}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <div className={field}>
            <label htmlFor="ws-status-reason" className="text-sm font-semibold">
              Internal reason
            </label>
            <Textarea
              id="ws-status-reason"
              rows={2}
              minLength={5}
              required
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            disabled={pending || status === props.currentStatus}
            className="self-start"
          >
            Request status change
          </Button>
        </form>
      )}
      {props.canPlan && (
        <form
          className="border-border flex flex-col gap-3 rounded-lg border-[1.5px] p-4"
          onSubmit={(e) => {
            e.preventDefault();
            send(
              { action: "workspace.plan", planId: plan, overrides, reason: planReason },
              () => setPlanReason(""),
            );
          }}
        >
          <h2 className="font-semibold">Plan</h2>
          <div className={field}>
            <label htmlFor="ws-plan" className="text-sm font-semibold">
              Plan
            </label>
            <select
              id="ws-plan"
              className={select}
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
            >
              {props.plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className={field}>
            <label htmlFor="ws-overrides" className="text-sm font-semibold">
              Overrides (JSON, optional)
            </label>
            <Textarea
              id="ws-overrides"
              rows={2}
              value={overrides}
              placeholder='{"members": 5}'
              onChange={(e) => setOverrides(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <div className={field}>
            <label htmlFor="ws-plan-reason" className="text-sm font-semibold">
              Reason
            </label>
            <Textarea
              id="ws-plan-reason"
              rows={2}
              minLength={5}
              required
              value={planReason}
              onChange={(e) => setPlanReason(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={pending} className="self-start">
            Request plan change
          </Button>
        </form>
      )}
    </section>
  );
}
