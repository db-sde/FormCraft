"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { pauseAiAction, requestAiChangeAction } from "../../actions";
import { FEATURE_LABEL } from "./labels";

const field = "flex flex-col gap-1";
const select = "border-input bg-field h-9 rounded-sm border-[1.5px] px-2 text-sm";

/** Asks for a settings change; someone else approves it on Approvals. */
export function AiChangeForm({ models }: { models: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [feature, setFeature] = useState("*");
  const [enabled, setEnabled] = useState("keep");
  const [model, setModel] = useState("keep");
  const [maxTokens, setMaxTokens] = useState("");
  const [ceiling, setCeiling] = useState("");
  const [reason, setReason] = useState("");
  const platform = feature === "*";
  return (
    <form
      className="border-border grid gap-3 rounded-lg border-[1.5px] p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await requestAiChangeAction({
            feature,
            enabled,
            model,
            maxTokens,
            ceilingUsd: platform ? ceiling : "",
            reason,
          });
          if (result.ok) {
            toast.success("Requested. Someone else approves it on Approvals.");
            setReason("");
            router.refresh();
          } else toast.error(result.error);
        });
      }}
    >
      <h2 className="font-semibold sm:col-span-2">Ask for a change</h2>
      <div className={field}>
        <label htmlFor="ai-feature" className="text-sm font-semibold">
          Setting for
        </label>
        <select
          id="ai-feature"
          className={select}
          value={feature}
          onChange={(e) => {
            setFeature(e.target.value);
            setModel("keep");
          }}
        >
          {Object.entries(FEATURE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className={field}>
        <label htmlFor="ai-enabled" className="text-sm font-semibold">
          On or off
        </label>
        <select
          id="ai-enabled"
          className={select}
          value={enabled}
          onChange={(e) => setEnabled(e.target.value)}
        >
          <option value="keep">Leave as it is</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </div>
      <div className={field}>
        <label htmlFor="ai-model" className="text-sm font-semibold">
          {platform ? "Default model" : "Model"}
        </label>
        <select
          id="ai-model"
          className={select}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          <option value="keep">Leave as it is</option>
          {!platform && <option value="default">Use the platform default</option>}
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div className={field}>
        <label htmlFor="ai-max" className="text-sm font-semibold">
          Max output tokens (blank: leave, “none”: no cap)
        </label>
        <Input
          id="ai-max"
          inputMode="numeric"
          placeholder="e.g. 4000"
          value={maxTokens}
          onChange={(e) => setMaxTokens(e.target.value)}
        />
      </div>
      {platform && (
        <div className={field}>
          <label htmlFor="ai-ceiling" className="text-sm font-semibold">
            Daily ceiling in US$ (blank: leave)
          </label>
          <Input
            id="ai-ceiling"
            inputMode="decimal"
            placeholder="e.g. 50"
            value={ceiling}
            onChange={(e) => setCeiling(e.target.value)}
          />
        </div>
      )}
      <div className={`${field} sm:col-span-2`}>
        <label htmlFor="ai-reason" className="text-sm font-semibold">
          Reason
        </label>
        <Textarea
          id="ai-reason"
          rows={2}
          required
          minLength={5}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <Button
        type="submit"
        disabled={pending}
        className="sm:col-span-2 sm:justify-self-start"
      >
        Request change
      </Button>
    </form>
  );
}

/** Turns AI off for everyone now. Turning it back on needs an approved request. */
export function PauseAiForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  return (
    <form
      className="border-border flex flex-col gap-3 rounded-lg border-[1.5px] p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await pauseAiAction({ reason });
          if (result.ok) {
            toast.success("AI is paused for every customer.");
            setReason("");
            router.refresh();
          } else toast.error(result.error);
        });
      }}
    >
      <h2 className="font-semibold">Pause AI now</h2>
      <p className="text-muted-foreground text-sm">
        Turns AI off for every customer at once, for an incident or runaway spend. Owners
        are told. Turning it back on needs an approved request.
      </p>
      <div className={field}>
        <label htmlFor="ai-pause-reason" className="text-sm font-semibold">
          Reason
        </label>
        <Input
          id="ai-pause-reason"
          required
          minLength={5}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <Button
        type="submit"
        variant="destructive"
        disabled={pending}
        className="self-start"
      >
        Pause AI
      </Button>
    </form>
  );
}
