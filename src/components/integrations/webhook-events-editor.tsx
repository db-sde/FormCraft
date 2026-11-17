"use client";

import { useState, useTransition } from "react";
import { toast } from "@/lib/toast";
import type { WebhookEvent } from "@/domains/webhooks";
import { setWebhookEventsAction } from "@/app/(form)/forms/[id]/(sections)/integrations/actions";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const EVENTS: { event: WebhookEvent; label: string; hint: string }[] = [
  {
    event: "response.completed",
    label: "Completed",
    hint: "Each submitted response.",
  },
  {
    event: "response.partial_saved",
    label: "Answers saved",
    hint: "Before submitting. At most one every 10 minutes per response, with the latest answers.",
  },
  {
    event: "response.abandoned",
    label: "Abandoned",
    hint: "Once, when an unfinished response has been idle for the time below.",
  },
  {
    event: "response.resumed",
    label: "Resumed",
    hint: "When someone comes back after an abandoned event.",
  },
];

/** Which events an endpoint gets (F-53). Unfinished-response events only
 * flow when the form keeps unfinished responses. */
export function WebhookEventsEditor({
  formId,
  endpointId,
  events,
  abandonAfterMinutes,
  keepsUnfinished,
  onSaved,
}: {
  formId: string;
  endpointId: string;
  events: WebhookEvent[];
  abandonAfterMinutes: number;
  keepsUnfinished: boolean;
  onSaved: (events: WebhookEvent[], abandonAfterMinutes: number) => void;
}) {
  const [chosen, setChosen] = useState<Set<WebhookEvent>>(new Set(events));
  const [minutes, setMinutes] = useState(String(abandonAfterMinutes));
  const [pending, start] = useTransition();
  const changed =
    chosen.size !== events.length ||
    events.some((e) => !chosen.has(e)) ||
    Number(minutes) !== abandonAfterMinutes;
  const unfinishedChosen = [...chosen].some((e) => e !== "response.completed");

  function save() {
    const list = EVENTS.map((e) => e.event).filter((e) => chosen.has(e));
    const n = Number(minutes);
    start(async () => {
      const result = await setWebhookEventsAction(formId, endpointId, {
        events: list,
        abandonAfterMinutes: Number.isInteger(n) ? n : abandonAfterMinutes,
      });
      if (result.ok) {
        onSaved(list, Number.isInteger(n) ? n : abandonAfterMinutes);
        toast.success("Events saved.");
      } else toast.error(result.message, { duration: 8000 });
    });
  }

  return (
    <fieldset className="border-border flex flex-col gap-2 border-b-[1.5px] px-3.5 py-3">
      <legend className="text-muted-foreground float-left pb-1 text-[11px] font-bold tracking-[0.08em] uppercase">
        Events
      </legend>
      {EVENTS.map(({ event, label, hint }) => (
        <label key={event} className="flex items-start gap-2.5 text-[13.5px]">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={chosen.has(event)}
            onChange={(e) => {
              const next = new Set(chosen);
              if (e.target.checked) next.add(event);
              else next.delete(event);
              setChosen(next);
            }}
          />
          <span>
            <b className="font-semibold">{label}</b>{" "}
            <span className="text-muted-foreground font-mono text-[12px]">{event}</span>
            <span className="text-muted-foreground block text-[12.5px]">{hint}</span>
          </span>
        </label>
      ))}
      {chosen.has("response.abandoned") && (
        <label className="flex items-center gap-2 pl-6 text-[13px]">
          Idle for
          <Input
            type="number"
            min={5}
            max={1440}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="h-8 w-20 text-[13px]"
            aria-label="Minutes idle before abandoned"
          />
          minutes (5 to 1440)
        </label>
      )}
      {unfinishedChosen && !keepsUnfinished && (
        <p className="rounded-sm bg-[var(--chip-changes-bg)] px-2.5 py-1.5 text-[12.5px]">
          This form doesn&apos;t keep unfinished responses, so only completed ones are
          sent. Turn on “Save unfinished responses” in its Settings to send the others.
        </p>
      )}
      {unfinishedChosen && keepsUnfinished && (
        <p className="text-muted-foreground text-[12.5px]">
          Unfinished answers leave FormCraft for this URL. Only choose these if your
          privacy notice covers it.
        </p>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 self-start"
        disabled={!changed || chosen.size === 0 || pending}
        onClick={save}
      >
        {pending && <ButtonSpinner />}
        Save events
      </Button>
    </fieldset>
  );
}
