"use client";

import { useState, useSyncExternalStore } from "react";
import { Calendar } from "lucide-react";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import {
  dateTimeValue,
  displayTime,
  isValidTimeZone,
  offeredTimes,
  parseDateTime,
} from "@/domains/logic/datetime";
import { cn } from "cn";

/** Underline select / date field, as the other answer fields (Part 6). */
const FIELD =
  "fc-input min-w-0 rounded-none border-0 border-b-2 border-(--st-line) bg-transparent py-2 text-(length:--st-input) text-(--st-text) outline-none focus:border-(--st-primary) focus-visible:shadow-none aria-invalid:border-[#c8372d] [color-scheme:light_dark]";

const noSubscribe = () => () => {};

type TimeSettings = {
  minTime?: string;
  maxTime?: string;
  stepMinutes?: number;
  hourCycle?: "12" | "24";
};

/**
 * A time of day as two native selects — hour, then minute — offering only
 * times inside the question's window and on its step (F-20). Native
 * selects are the dependable picker on phones, and unlike the browser's
 * time field they can show 12- or 24-hour time whatever the device's
 * locale. Picking an hour picks its first minute, so one choice is enough
 * for a whole hour.
 */
function TimeSelect({
  settings,
  value,
  onChange,
  label,
  idPrefix,
  autoFocus,
  invalid,
}: {
  settings: TimeSettings;
  value: string | undefined;
  onChange: (time: string | undefined) => void;
  label: string;
  idPrefix: string;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  const times = offeredTimes(settings);
  const hourCycle = settings.hourCycle ?? "24";
  const hours = [...new Set(times.map((t) => t.slice(0, 2)))];
  const hour = value?.slice(0, 2) ?? "";
  const minutes = times.filter((t) => t.startsWith(`${hour}:`)).map((t) => t.slice(3));
  const hourLabel = (h: string) =>
    hourCycle === "24" ? h : displayTime(`${h}:00`, "12").replace(":00", "");

  return (
    <div className="flex items-end gap-2">
      <select
        id={`${idPrefix}-hour`}
        autoFocus={autoFocus}
        aria-label={`${label}: hour`}
        aria-invalid={invalid || undefined}
        value={hour}
        onChange={(e) => {
          const h = e.target.value;
          if (!h) return onChange(undefined);
          const keep = value && times.includes(`${h}:${value.slice(3)}`);
          onChange(
            keep ? `${h}:${value!.slice(3)}` : times.find((t) => t.startsWith(`${h}:`)),
          );
        }}
        className={cn(FIELD, "w-28")}
      >
        <option value="">Hour</option>
        {hours.map((h) => (
          <option key={h} value={h}>
            {hourLabel(h)}
          </option>
        ))}
      </select>
      <span aria-hidden className="pb-2 text-(length:--st-input)">
        :
      </span>
      <select
        id={`${idPrefix}-minute`}
        aria-label={`${label}: minute`}
        aria-invalid={invalid || undefined}
        value={value?.slice(3) ?? ""}
        disabled={!hour}
        onChange={(e) =>
          onChange(e.target.value ? `${hour}:${e.target.value}` : undefined)
        }
        className={cn(FIELD, "w-24 disabled:opacity-50")}
      >
        <option value="">Min</option>
        {minutes.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {value && hourCycle === "12" && (
        <span className="pb-2.5 text-[13.5px] text-(--st-muted)">
          {displayTime(value, "12")}
        </span>
      )}
    </div>
  );
}

export function TimeInput({
  question,
  value,
  onChange,
  idPrefix,
  autoFocus,
  invalid,
}: {
  question: Extract<QuestionV1, { type: "time" }>;
  value: unknown;
  onChange: (value: unknown) => void;
  idPrefix: string;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  return (
    <TimeSelect
      settings={question.settings}
      value={typeof value === "string" ? value : undefined}
      onChange={onChange}
      label={question.label}
      idPrefix={idPrefix}
      autoFocus={autoFocus}
      invalid={invalid}
    />
  );
}

/**
 * A date and a time; the answer is the wall time plus its UTC offset —
 * in the question's zone when it has one, otherwise this browser's
 * (F-20). The zone is always said, so nobody guesses which one it is.
 */
export function DateTimeInput({
  question,
  value,
  onChange,
  idPrefix,
  autoFocus,
  invalid,
}: {
  question: Extract<QuestionV1, { type: "datetime" }>;
  value: unknown;
  onChange: (value: unknown) => void;
  idPrefix: string;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  const stored = typeof value === "string" ? parseDateTime(value) : null;
  // Half-picked (a date but no time yet) lives here until it's complete.
  const [draft, setDraft] = useState<{ date: string; time?: string }>(() => ({
    date: stored?.date ?? "",
    time: stored?.time,
  }));
  const [gap, setGap] = useState(false);
  const zone =
    question.settings.timeZone && isValidTimeZone(question.settings.timeZone)
      ? question.settings.timeZone
      : undefined;
  // The browser's zone, filled in after the server's pass (which can't
  // know it) so the two renders agree.
  const isClient = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  const ownZone = isClient ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";

  function update(next: { date: string; time?: string }) {
    setDraft(next);
    if (!next.date || !next.time) {
      setGap(false);
      onChange(undefined);
      return;
    }
    const combined = dateTimeValue(next.date, next.time, zone);
    setGap(combined === null);
    onChange(combined ?? undefined);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="flex items-end gap-2.5">
          <input
            id={`${idPrefix}-date`}
            type="date"
            autoFocus={autoFocus}
            aria-label={`${question.label}: date`}
            aria-invalid={invalid || undefined}
            value={draft.date}
            min={question.settings.minDate}
            max={question.settings.maxDate}
            onChange={(e) => update({ ...draft, date: e.target.value })}
            className={cn(
              FIELD,
              "w-auto [&::-webkit-calendar-picker-indicator]:opacity-0",
            )}
          />
          <span
            aria-hidden
            className="mb-1.5 grid size-[38px] place-items-center rounded-(--st-tile-br) border-[1.5px] border-(--st-line)"
          >
            <Calendar className="size-[18px]" />
          </span>
        </div>
        <TimeSelect
          settings={question.settings}
          value={draft.time}
          onChange={(time) => update({ ...draft, time })}
          label={question.label}
          idPrefix={idPrefix}
          invalid={invalid}
        />
      </div>
      <p className="text-[13px] text-(--st-muted)">
        {zone
          ? `Times are in ${zone.replace(/_/g, " ")}.`
          : ownZone && `Your time zone: ${ownZone.replace(/_/g, " ")}.`}
      </p>
      {gap && (
        <p role="alert" className="text-[13.5px] font-semibold text-[#c8372d]">
          That time doesn&apos;t exist there (the clocks change). Choose another.
        </p>
      )}
    </div>
  );
}
