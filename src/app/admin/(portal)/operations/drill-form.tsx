"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { recordDrillAction } from "../../actions";
import { DRILL_LABEL } from "./labels";

const field = "flex flex-col gap-1";
const select = "border-input bg-field h-9 rounded-sm border-[1.5px] px-2 text-sm";

/** Records an outage, lockout or incident drill (restores have their own). */
export function DrillForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState("webhook_outage");
  const [scenario, setScenario] = useState("");
  const [outcome, setOutcome] = useState("");
  const [followUps, setFollowUps] = useState("");
  const [evidence, setEvidence] = useState("");
  const [succeeded, setSucceeded] = useState(true);
  return (
    <form
      className="border-border grid gap-3 rounded-lg border-[1.5px] p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await recordDrillAction({
            kind,
            scenario,
            outcome,
            succeeded,
            followUps,
            evidenceUrl: evidence || null,
          });
          if (result.ok) {
            toast.success("Drill recorded.");
            setScenario("");
            setOutcome("");
            setFollowUps("");
            setEvidence("");
            router.refresh();
          } else toast.error(result.error);
        });
      }}
    >
      <h2 className="font-semibold sm:col-span-2">Record an outage or incident drill</h2>
      <div className={field}>
        <label htmlFor="dr-kind" className="text-sm font-semibold">
          Drill
        </label>
        <select
          id="dr-kind"
          className={select}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {Object.entries(DRILL_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className={field}>
        <label htmlFor="dr-evidence" className="text-sm font-semibold">
          Drill evidence link (https, optional)
        </label>
        <Input
          id="dr-evidence"
          type="url"
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
        />
      </div>
      <div className={`${field} sm:col-span-2`}>
        <label htmlFor="dr-scenario" className="text-sm font-semibold">
          What was tried
        </label>
        <Textarea
          id="dr-scenario"
          rows={2}
          required
          minLength={5}
          maxLength={1000}
          placeholder="Pointed a test webhook at a URL returning 503 for 20 minutes"
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
        />
      </div>
      <div className={`${field} sm:col-span-2`}>
        <label htmlFor="dr-outcome" className="text-sm font-semibold">
          What happened
        </label>
        <Textarea
          id="dr-outcome"
          rows={2}
          required
          minLength={5}
          maxLength={2000}
          placeholder="Alert arrived after 30 minutes; every event delivered once on recovery"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
        />
      </div>
      <div className={`${field} sm:col-span-2`}>
        <label htmlFor="dr-follow" className="text-sm font-semibold">
          Follow-ups (optional)
        </label>
        <Input
          id="dr-follow"
          maxLength={2000}
          value={followUps}
          onChange={(e) => setFollowUps(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          checked={succeeded}
          onChange={(e) => setSucceeded(e.target.checked)}
        />
        It went as the runbook says
      </label>
      <Button
        type="submit"
        disabled={pending}
        className="sm:col-span-2 sm:justify-self-start"
      >
        Record this drill
      </Button>
    </form>
  );
}
