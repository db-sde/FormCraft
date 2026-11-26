"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestUpgradeAction } from "@/app/(dashboard)/settings/plan-actions";

/** Asks FormCraft to move the workspace to a bigger plan. Until online
 * checkout exists, the team changes the plan and gets in touch about
 * billing. */
export function UpgradeRequest({
  plans,
}: {
  plans: { id: string; name: string; monthly: number; annual: number }[];
}) {
  const [pending, start] = useTransition();
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  if (plans.length === 0) return null;
  if (sent) {
    return (
      <p role="status" className="text-[13.5px]">
        Request sent. We&apos;ll be in touch about billing and switch your plan.
      </p>
    );
  }
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await requestUpgradeAction(planId, note);
          if (result.ok) setSent(true);
          else toast.error(result.message);
        });
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="upgrade-plan" className="text-sm font-semibold">
          Plan
        </label>
        <select
          id="upgrade-plan"
          className="border-input bg-field h-9 rounded-sm border-[1.5px] px-2 text-sm"
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
        >
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}: ${p.annual}/month billed yearly, or ${p.monthly} monthly
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="upgrade-note" className="text-sm font-semibold">
          Anything we should know (optional)
        </label>
        <Input
          id="upgrade-note"
          maxLength={1000}
          placeholder="Billing yearly, GST number, extra seats…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        Request this plan
      </Button>
    </form>
  );
}
