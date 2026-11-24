"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { requestPlanChangeAction } from "../../actions";

/** Ask for a change to a plan's entitlements (approved by someone else). */
export function PlanEditor({
  plans,
}: {
  plans: { id: string; name: string; entitlements: Record<string, unknown> }[];
}) {
  const [pending, start] = useTransition();
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const current = plans.find((p) => p.id === planId);
  const [json, setJson] = useState(JSON.stringify(current?.entitlements ?? {}, null, 2));
  const [reason, setReason] = useState("");
  return (
    <form
      className="border-border flex flex-col gap-3 rounded-lg border-[1.5px] p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await requestPlanChangeAction({
            planId,
            entitlements: json,
            reason,
          });
          if (result.ok) {
            toast.success("Requested. Someone else approves it on Approvals.");
            setReason("");
          } else toast.error(result.error);
        });
      }}
    >
      <h2 className="font-semibold">Change a plan</h2>
      <p className="text-muted-foreground text-sm">
        Applies to every workspace on the plan. Features are true or false; limits are
        whole numbers, or null for unlimited. Unknown keys are refused.
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor="plan-id" className="text-sm font-semibold">
          Plan
        </label>
        <select
          id="plan-id"
          className="border-input bg-field h-9 rounded-sm border-[1.5px] px-2 text-sm"
          value={planId}
          onChange={(e) => {
            setPlanId(e.target.value);
            const p = plans.find((x) => x.id === e.target.value);
            setJson(JSON.stringify(p?.entitlements ?? {}, null, 2));
          }}
        >
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="plan-json" className="text-sm font-semibold">
          Entitlements (JSON)
        </label>
        <Textarea
          id="plan-json"
          rows={12}
          value={json}
          onChange={(e) => setJson(e.target.value)}
          className="font-mono text-xs"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="plan-reason" className="text-sm font-semibold">
          Reason
        </label>
        <Textarea
          id="plan-reason"
          rows={2}
          minLength={5}
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        Request plan change
      </Button>
    </form>
  );
}
