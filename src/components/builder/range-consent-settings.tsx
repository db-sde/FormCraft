"use client";

import { CONSENT_KINDS, type QuestionV1 } from "@/domains/forms/schema/v1";
import { CONSENT_KIND_LABELS } from "@/domains/forms/range-consent";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "cn";
import { PANEL_INPUT, PanelField, PanelNote, SectionHead, Segmented } from "./panel-ui";

type DateRangeQuestion = Extract<QuestionV1, { type: "date_range" }>;
type ConsentQuestion = Extract<QuestionV1, { type: "consent" }>;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A number box that stores undefined when empty. */
function wholeNumber(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

// --- date range (F-58) -------------------------------------------------------

export function DateRangeSettingsPanel({
  question,
  onChange,
}: {
  question: DateRangeQuestion;
  onChange: (question: DateRangeQuestion) => void;
}) {
  const s = question.settings;
  const set = (patch: Partial<DateRangeQuestion["settings"]>) =>
    onChange({ ...question, settings: { ...s, ...patch } });
  const unit = s.count === "nights" ? "nights" : "days";
  const blocked = (s.disabledDates ?? []).join("\n");

  return (
    <>
      <SectionHead>Range</SectionHead>
      <div className="col-span-full">
        <Segmented
          label="Count the length in"
          value={s.count ?? "days"}
          options={[
            { value: "days", label: "Days" },
            { value: "nights", label: "Nights" },
          ]}
          onChange={(count) => set({ count })}
        />
      </div>
      <PanelNote>
        {s.count === "nights"
          ? "Mon to Wed is 2 nights. The end must be after the start (a hotel stay)."
          : "Mon to Wed is 3 days, both ends included. Start and end can be the same day."}
      </PanelNote>
      <PanelField label="Start label" half>
        <Input
          className={PANEL_INPUT}
          value={s.startLabel ?? ""}
          placeholder={s.count === "nights" ? "Check-in" : "Start date"}
          maxLength={60}
          onChange={(e) => set({ startLabel: e.target.value || undefined })}
        />
      </PanelField>
      <PanelField label="End label" half>
        <Input
          className={PANEL_INPUT}
          value={s.endLabel ?? ""}
          placeholder={s.count === "nights" ? "Check-out" : "End date"}
          maxLength={60}
          onChange={(e) => set({ endLabel: e.target.value || undefined })}
        />
      </PanelField>

      <SectionHead>Limits</SectionHead>
      <PanelField label="Earliest date" half>
        <Input
          className={PANEL_INPUT}
          type="date"
          value={s.minDate ?? ""}
          onChange={(e) => set({ minDate: e.target.value || undefined })}
        />
      </PanelField>
      <PanelField label="Latest date" half>
        <Input
          className={PANEL_INPUT}
          type="date"
          value={s.maxDate ?? ""}
          onChange={(e) => set({ maxDate: e.target.value || undefined })}
        />
      </PanelField>
      <PanelField label={`Shortest (${unit})`} half>
        <Input
          className={PANEL_INPUT}
          type="number"
          min={0}
          value={s.minDays ?? ""}
          onChange={(e) => set({ minDays: wholeNumber(e.target.value) })}
        />
      </PanelField>
      <PanelField label={`Longest (${unit})`} half>
        <Input
          className={PANEL_INPUT}
          type="number"
          min={1}
          value={s.maxDays ?? ""}
          onChange={(e) => {
            const n = wholeNumber(e.target.value);
            set({ maxDays: n === 0 ? undefined : n });
          }}
        />
      </PanelField>
      <div className="col-span-full grid gap-1.5">
        <span
          className="text-ink text-[13px] font-semibold"
          id={`${question.id}-weekdays`}
        >
          Neither date on
        </span>
        <div
          role="group"
          aria-labelledby={`${question.id}-weekdays`}
          className="flex flex-wrap gap-1.5"
        >
          {WEEKDAYS.map((name, day) => {
            const on = s.disabledWeekdays?.includes(day) ?? false;
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = on
                    ? (s.disabledWeekdays ?? []).filter((d) => d !== day)
                    : [...(s.disabledWeekdays ?? []), day].sort();
                  // Every day blocked would leave nothing to choose.
                  if (next.length > 6) return;
                  set({ disabledWeekdays: next.length ? next : undefined });
                }}
                className={cn(
                  "border-ink h-8 rounded-md border-[1.5px] px-2.5 text-xs font-semibold",
                  on ? "bg-ink text-white" : "bg-white",
                )}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>
      <PanelField
        label="Unavailable dates"
        hint="One per line, as YYYY-MM-DD. Neither the start nor the end can fall on them."
      >
        <Textarea
          rows={3}
          className="min-h-0 text-sm"
          defaultValue={blocked}
          placeholder={"2026-12-25\n2026-12-26"}
          onBlur={(e) => {
            const days = e.target.value
              .split(/[\s,]+/)
              .map((d) => d.trim())
              .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
            set({
              disabledDates: days.length ? [...new Set(days)].slice(0, 200) : undefined,
            });
          }}
        />
      </PanelField>
    </>
  );
}

// --- consent (F-62) ----------------------------------------------------------

export function ConsentSettingsPanel({
  question,
  onChange,
}: {
  question: ConsentQuestion;
  onChange: (question: ConsentQuestion) => void;
}) {
  const s = question.settings;
  const set = (patch: Partial<ConsentQuestion["settings"]>) =>
    onChange({ ...question, settings: { ...s, ...patch } });

  return (
    <>
      <SectionHead>Notice</SectionHead>
      <PanelField
        label="Kind of notice"
        hint="Kept with each answer, next to the version."
      >
        <Select
          value={s.kind ?? "none"}
          onValueChange={(v) =>
            set({
              kind: v === "none" ? undefined : (v as (typeof CONSENT_KINDS)[number]),
            })
          }
        >
          <SelectTrigger className="h-[38px] w-full" aria-label="Kind of notice">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Not set</SelectItem>
            {CONSENT_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {CONSENT_KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PanelField>
      <PanelField
        label="Notice text"
        hint="Paragraphs, **bold**, *italic*, lines starting with - for a list, ## for a heading, and [link text](https://…)."
      >
        <Textarea
          rows={8}
          className="text-sm"
          value={s.content}
          maxLength={20000}
          onChange={(e) => set({ content: e.target.value })}
        />
      </PanelField>
      <PanelField label="Checkbox text">
        <Input
          className={PANEL_INPUT}
          value={s.acknowledgeLabel}
          maxLength={300}
          onChange={(e) => set({ acknowledgeLabel: e.target.value })}
        />
      </PanelField>
      <div className="col-span-full flex items-center justify-between gap-3">
        <span className="text-ink text-[13px] font-semibold">Optional opt-in</span>
        <Switch
          aria-label="Optional opt-in"
          checked={s.optInLabel !== undefined}
          onCheckedChange={(on) =>
            set({ optInLabel: on ? "Send me occasional news and offers" : undefined })
          }
        />
      </div>
      {s.optInLabel !== undefined && (
        <PanelField label="Opt-in text" hint="Never ticked for them, and never required.">
          <Input
            className={PANEL_INPUT}
            value={s.optInLabel}
            maxLength={300}
            onChange={(e) => set({ optInLabel: e.target.value })}
          />
        </PanelField>
      )}
      <PanelField
        label="Version name"
        hint="Optional, like “Privacy notice v3”. Each answer also keeps a code for the exact wording it accepted, so changing a word starts a new version."
      >
        <Input
          className={PANEL_INPUT}
          value={s.versionLabel ?? ""}
          maxLength={80}
          onChange={(e) => set({ versionLabel: e.target.value || undefined })}
        />
      </PanelField>
      <PanelNote>
        Turn on Required (above) to stop people going on until they tick the box. This
        records what was shown and ticked, and when. It isn&apos;t legal advice or proof
        of compliance.
      </PanelNote>
    </>
  );
}
