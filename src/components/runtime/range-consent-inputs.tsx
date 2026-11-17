"use client";

import { Fragment, type ReactNode } from "react";
import { Calendar } from "lucide-react";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import {
  consentParts,
  isCalendarDay,
  rangeLength,
  rangeParts,
} from "@/domains/forms/range-consent";
import { cn } from "cn";

const UNDERLINE =
  "fc-input w-full min-w-0 rounded-none border-0 border-b-2 border-(--st-line) bg-transparent py-1.5 text-[calc(var(--st-input)*0.82)] text-(--st-text) outline-none placeholder:text-(--st-muted) focus:border-(--st-primary) focus-visible:shadow-none aria-invalid:border-[#c8372d]";

const WEEKDAYS = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
];

/** The day after a YYYY-MM-DD day. */
function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// --- date range (F-58) -------------------------------------------------------

/**
 * Two native date fields, so every phone shows its own picker and the
 * keyboard works as anywhere else. The end can't be set before the start;
 * the length shows as they choose. Days of the week that can't be picked
 * are said in words (a native field can't grey them out); the check
 * itself is the shared validation, here and on the server.
 */
export function DateRangeInput({
  question,
  value,
  onChange,
  idPrefix,
  autoFocus,
  invalid,
}: {
  question: Extract<QuestionV1, { type: "date_range" }>;
  value: unknown;
  onChange: (value: unknown) => void;
  idPrefix: string;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  const parts = rangeParts(value) ?? {};
  const start = typeof parts.start === "string" ? parts.start : "";
  const end = typeof parts.end === "string" ? parts.end : "";
  const s = question.settings;
  const count = s.count ?? "days";
  const length =
    isCalendarDay(start) && isCalendarDay(end) && end >= start
      ? rangeLength(start, end, count)
      : null;

  function set(next: { start?: string; end?: string }) {
    const merged = { start, end, ...next };
    const out: Record<string, string> = {};
    if (merged.start) out.start = merged.start;
    if (merged.end) out.end = merged.end;
    onChange(Object.keys(out).length ? out : undefined);
  }

  const endMin = start ? (count === "nights" ? nextDay(start) : start) : s.minDate;
  const limits = [
    s.disabledWeekdays?.length
      ? `Not on ${s.disabledWeekdays.map((d) => WEEKDAYS[d]).join(" or ")}.`
      : null,
    s.minDays !== undefined || s.maxDays !== undefined
      ? `${s.minDays !== undefined ? `At least ${s.minDays}` : ""}${
          s.minDays !== undefined && s.maxDays !== undefined
            ? ", at most "
            : s.maxDays !== undefined
              ? "At most "
              : ""
        }${s.maxDays !== undefined ? s.maxDays : ""} ${count}.`
      : null,
  ].filter(Boolean);

  return (
    <div className="grid gap-3">
      <div className="grid gap-4 sm:grid-cols-2">
        {(
          [
            [
              "start",
              s.startLabel || (count === "nights" ? "Check-in" : "Start date"),
              start,
              s.minDate,
              s.maxDate,
            ],
            [
              "end",
              s.endLabel || (count === "nights" ? "Check-out" : "End date"),
              end,
              endMin,
              s.maxDate,
            ],
          ] as const
        ).map(([which, label, current, min, max], index) => {
          const id = `${idPrefix}-${which}`;
          return (
            <div key={which} className="grid gap-1">
              <label htmlFor={id} className="text-[13px] font-semibold text-(--st-muted)">
                {label}
              </label>
              <div className="flex items-end gap-2">
                <input
                  id={id}
                  type="date"
                  autoFocus={autoFocus && index === 0}
                  aria-invalid={invalid || undefined}
                  value={current}
                  min={min}
                  max={max}
                  onChange={(e) => {
                    const v = e.target.value;
                    // Moving the start past the end clears the end.
                    if (which === "start" && end && v && end < v)
                      set({ start: v, end: "" });
                    else set({ [which]: v });
                  }}
                  className={cn(
                    UNDERLINE,
                    "w-auto [color-scheme:light_dark] [&::-webkit-calendar-picker-indicator]:opacity-0",
                  )}
                />
                <span
                  aria-hidden
                  className="mb-1 grid size-[34px] place-items-center rounded-(--st-tile-br) border-[1.5px] border-(--st-line)"
                >
                  <Calendar className="size-4" />
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-sm text-(--st-muted)" aria-live="polite" data-fc="range-length">
        {length !== null
          ? `${length} ${count === "nights" ? (length === 1 ? "night" : "nights") : length === 1 ? "day" : "days"}`
          : null}
        {length !== null && limits.length ? " · " : null}
        {limits.join(" ")}
      </p>
    </div>
  );
}

// --- consent (F-62) ----------------------------------------------------------

/** A notice's light formatting as React elements: paragraphs, "## "
 * headings, "- " lists, **bold**, *italic* and [links](https://…). Never
 * HTML, so nothing the creator types can run in the respondent's page. */
export function NoticeText({ text }: { text: string }) {
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n").filter((l) => l.trim() !== "");
        if (lines.length === 0) return null;
        if (lines.every((l) => /^\s*[-*] /.test(l))) {
          return (
            <ul key={i} className="my-2 list-disc ps-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*] /, ""))}</li>
              ))}
            </ul>
          );
        }
        if (lines.length === 1 && /^#{1,3} /.test(lines[0])) {
          return (
            <p key={i} className="mt-3 mb-1 font-semibold text-(--st-text)">
              {inline(lines[0].replace(/^#{1,3} /, ""))}
            </p>
          );
        }
        return (
          <p key={i} className="my-2">
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

const INLINE =
  /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={m.index}>{m[1]}</strong>);
    else if (m[2]) out.push(<em key={m.index}>{m[2]}</em>);
    else
      out.push(
        <a
          key={m.index}
          href={m[4]}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="underline underline-offset-2"
        >
          {m[3]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * The notice in a box that scrolls on its own, then the box to tick
 * (required to go on when the question is) and an optional opt-in that
 * is never ticked for them. Native checkboxes: Space ticks, screen
 * readers read the label.
 */
export function ConsentInput({
  question,
  value,
  onChange,
  idPrefix,
  autoFocus,
  invalid,
}: {
  question: Extract<QuestionV1, { type: "consent" }>;
  value: unknown;
  onChange: (value: unknown) => void;
  idPrefix: string;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  const parts = consentParts(value) ?? {};
  const acknowledged = parts.acknowledged === true;
  const optIn = parts.optIn === true;
  const s = question.settings;
  const noticeId = `${idPrefix}-notice`;

  function set(next: { acknowledged?: boolean; optIn?: boolean }) {
    const merged = { acknowledged, ...(s.optInLabel ? { optIn } : {}), ...next };
    onChange(merged);
  }

  return (
    <div className="grid gap-4">
      <div
        id={noticeId}
        tabIndex={0}
        role="region"
        aria-label="Notice"
        data-fc="notice"
        className="max-h-[min(320px,45dvh)] overflow-y-auto rounded-(--st-tile-br) border-[1.5px] border-(--st-line) px-4 py-2 text-[15px] leading-relaxed text-(--st-text) focus-visible:outline-2 focus-visible:outline-(--st-primary)"
      >
        <NoticeText text={s.content} />
      </div>
      <label className="flex cursor-pointer items-start gap-3 text-[15px] text-(--st-text)">
        <input
          type="checkbox"
          autoFocus={autoFocus}
          checked={acknowledged}
          aria-invalid={invalid || undefined}
          aria-describedby={noticeId}
          onChange={(e) => set({ acknowledged: e.target.checked })}
          className="mt-0.5 size-5 shrink-0 accent-(--st-primary)"
        />
        <span>
          {s.acknowledgeLabel}
          {question.required && (
            <span aria-hidden className="text-(--st-primary)">
              {" "}
              *
            </span>
          )}
        </span>
      </label>
      {s.optInLabel && (
        <label className="flex cursor-pointer items-start gap-3 text-[15px] text-(--st-text)">
          <input
            type="checkbox"
            checked={optIn}
            onChange={(e) => set({ optIn: e.target.checked })}
            className="mt-0.5 size-5 shrink-0 accent-(--st-primary)"
          />
          <span>
            {s.optInLabel} <span className="text-(--st-muted)">(optional)</span>
          </span>
        </label>
      )}
    </div>
  );
}
