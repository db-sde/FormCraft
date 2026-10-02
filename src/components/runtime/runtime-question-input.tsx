"use client";

import { useRuntimeStrings } from "./runtime-strings";
import { useEffect, useId, useRef, useState } from "react";
import {
  Calendar,
  Check,
  ChevronDown,
  FileCheck,
  FileX,
  Search,
  Star,
  Upload,
  X,
} from "lucide-react";
import { Checkbox as CheckboxPrimitive, RadioGroup as RadioPrimitive } from "radix-ui";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { OTHER_PREFIX } from "@/domains/logic";
import { cn } from "cn";
import {
  CONTACT_FIELD_LABELS,
  type ContactField,
} from "@/domains/forms/schema/question-types";
import { StageError } from "./stage";

/** Radio item value for the "Other" choice only — never stored. */
const OTHER_OPTION_ID = "__other__";
const KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Underline field (Part 6): no box, a 2px line that turns primary on focus. */
const UNDERLINE =
  "w-full min-w-0 rounded-none border-0 border-b-2 border-(--st-line) bg-transparent py-2 text-(length:--st-input) text-(--st-text) outline-none placeholder:text-(--st-muted) focus:border-(--st-primary) focus-visible:shadow-none aria-invalid:border-[#c8372d]";

/** A choice tile: primary border + 16% fill when chosen, 8% wash on hover. */
const TILE =
  "group/tile relative flex w-full cursor-pointer flex-col gap-2 rounded-(--st-tile-br) border-[1.5px] border-(--st-line) bg-(--st-field) p-(--st-tile-pad) text-left text-(length:--st-tile) text-(--st-text) transition-colors hover:bg-(--st-hover) data-[state=checked]:border-(--st-primary) data-[state=checked]:bg-(--st-sel) data-[beat=true]:[animation:fc-beat_350ms_cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:data-[beat=true]:animate-none";

const KEY =
  "grid size-6 shrink-0 place-items-center rounded-(--st-key-br) border border-(--st-line) text-xs font-bold group-data-[state=checked]/tile:border-(--st-primary) group-data-[state=checked]/tile:bg-(--st-primary) group-data-[state=checked]/tile:text-(--st-on-primary)";

/** Pulse a tile for 350ms after it's chosen (Part 1 Motion: "Choice confirm"). */
function useBeat(): [string | null, (id: string) => void] {
  const [beat, setBeat] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [
    beat,
    (id) => {
      setBeat(id);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setBeat(null), 350);
    },
  ];
}

/** The real, working input for each question type, styled by the stage
 * (Part 6). Used by the public form, the builder's Preview and — with
 * `preview` — the builder canvas, so all three always match. */
export function RuntimeQuestionInput({
  question,
  value,
  onChange,
  getResponseId,
  preview = false,
  invalid = false,
}: {
  question: QuestionV1;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Only present in the real public runtime, never the builder's
   * Preview dialog — file_upload uses it to get (creating on demand) the
   * response to upload against. Preview just tracks a filename locally,
   * keeping its no-network-calls guarantee. */
  getResponseId?: () => Promise<string>;
  /** Builder canvas: drawn as respondents see it, but not interactive. */
  preview?: boolean;
  invalid?: boolean;
}) {
  const strings = useRuntimeStrings();
  const control = renderControl();
  if (!preview) return control;
  return (
    <div aria-hidden inert className="pointer-events-none select-none">
      {control}
    </div>
  );

  function renderControl() {
    const text = typeof value === "string" ? value : "";
    switch (question.type) {
      case "welcome_screen":
      case "statement":
        return null;

      case "short_text":
        return (
          <input
            autoFocus={!preview}
            value={text}
            aria-invalid={invalid || undefined}
            aria-label={question.label}
            onChange={(e) => onChange(e.target.value)}
            placeholder={question.settings.placeholder || strings.typeAnswer}
            maxLength={question.settings.maxLength}
            className={UNDERLINE}
          />
        );

      case "long_text":
        return (
          <textarea
            autoFocus={!preview}
            rows={2}
            value={text}
            aria-invalid={invalid || undefined}
            aria-label={question.label}
            onChange={(e) => onChange(e.target.value)}
            placeholder={question.settings.placeholder || strings.typeAnswer}
            maxLength={question.settings.maxLength}
            className={cn(
              UNDERLINE,
              "field-sizing-content min-h-(--st-long-h) resize-none leading-[1.45]",
            )}
          />
        );

      case "email":
        return (
          <input
            autoFocus={!preview}
            type="email"
            autoComplete="email"
            value={text}
            aria-invalid={invalid || undefined}
            aria-label={question.label}
            onChange={(e) => onChange(e.target.value)}
            placeholder="name@example.com"
            className={UNDERLINE}
          />
        );

      case "phone":
        return (
          <input
            autoFocus={!preview}
            type="tel"
            autoComplete="tel"
            value={text}
            aria-invalid={invalid || undefined}
            aria-label={question.label}
            onChange={(e) => onChange(e.target.value)}
            placeholder="+1 555 000 0000"
            className={UNDERLINE}
          />
        );

      case "url":
        return (
          <input
            autoFocus={!preview}
            type="url"
            value={text}
            aria-invalid={invalid || undefined}
            aria-label={question.label}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://example.com"
            className={UNDERLINE}
          />
        );

      case "number":
        return (
          <input
            autoFocus={!preview}
            type="number"
            aria-invalid={invalid || undefined}
            aria-label={question.label}
            inputMode={question.settings.decimals === 0 ? "numeric" : "decimal"}
            step={
              question.settings.decimals === undefined
                ? "any"
                : 10 ** -question.settings.decimals
            }
            value={typeof value === "number" ? value : ""}
            min={question.settings.min}
            max={question.settings.max}
            placeholder="Type a number"
            onChange={(e) =>
              onChange(e.target.value === "" ? undefined : Number(e.target.value))
            }
            className={cn(
              UNDERLINE,
              "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none",
            )}
          />
        );

      case "date":
        return (
          <div className="flex max-w-(--st-tile-max) items-end gap-2.5">
            <input
              autoFocus={!preview}
              type="date"
              aria-invalid={invalid || undefined}
              aria-label={question.label}
              value={text}
              min={question.settings.minDate}
              max={question.settings.maxDate}
              onChange={(e) => onChange(e.target.value)}
              className={cn(
                UNDERLINE,
                "w-auto [color-scheme:light_dark] [&::-webkit-calendar-picker-indicator]:opacity-0",
              )}
            />
            <span
              aria-hidden
              className="mb-1.5 grid size-[38px] place-items-center rounded-(--st-tile-br) border-[1.5px] border-(--st-line)"
            >
              <Calendar className="size-[18px]" />
            </span>
          </div>
        );

      case "single_select":
        return <SingleSelect question={question} value={value} onChange={onChange} />;

      case "multi_select":
        return <MultiSelect question={question} value={value} onChange={onChange} />;

      case "dropdown":
        return (
          <Dropdown
            options={question.settings.options}
            value={text}
            onChange={onChange}
            label={question.label}
            autoFocus={!preview}
          />
        );

      case "yes_no":
        return <YesNo question={question} value={value} onChange={onChange} />;

      case "rating":
        return (
          <Rating scale={question.settings.scale} value={value} onChange={onChange} />
        );

      case "opinion_scale":
        return <OpinionScale question={question} value={value} onChange={onChange} />;

      case "file_upload":
        return (
          <FileUploadInput
            question={question}
            value={value}
            onChange={onChange}
            getResponseId={getResponseId}
          />
        );

      case "contact_info":
        return (
          <ContactInfoInput
            fields={question.settings.fields}
            requiredFields={question.settings.requiredFields}
            value={value}
            onChange={onChange}
            autoFocus={!preview}
          />
        );
    }
  }
}

function SingleSelect({
  question,
  value,
  onChange,
}: {
  question: Extract<QuestionV1, { type: "single_select" }>;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [beat, pulse] = useBeat();
  const selected = typeof value === "string" ? value : "";
  // "Other" is stored as `other:<text>` from the moment it's picked
  // (never an internal sentinel), so the stored value always means
  // something and the text box stays open while typing.
  const isOther = selected.startsWith(OTHER_PREFIX);
  const options = [
    ...question.settings.options.map((o) => ({ id: o.id, label: o.label })),
    ...(question.settings.allowOther ? [{ id: OTHER_OPTION_ID, label: "Other" }] : []),
  ];

  return (
    <RadioPrimitive.Root
      aria-label={question.label}
      value={isOther ? OTHER_OPTION_ID : selected}
      onValueChange={(next) => {
        pulse(next);
        onChange(next === OTHER_OPTION_ID ? OTHER_PREFIX : next);
      }}
      className="flex max-w-(--st-tile-max) flex-col gap-2"
    >
      {options.map((o, i) => {
        const checked = (isOther ? OTHER_OPTION_ID : selected) === o.id;
        return (
          <RadioPrimitive.Item
            key={o.id}
            value={o.id}
            data-key={KEYS[i]}
            data-beat={beat === o.id || undefined}
            className={TILE}
          >
            <span className="flex items-center gap-3">
              <span aria-hidden className={KEY}>
                {KEYS[i]}
              </span>
              <span className="flex-1 group-data-[state=checked]/tile:font-semibold">
                {o.label}
              </span>
              {checked && (
                <Check aria-hidden className="size-[18px] text-(--st-primary)" />
              )}
            </span>
            {o.id === OTHER_OPTION_ID && isOther && (
              <input
                autoFocus
                aria-label="Your answer"
                placeholder="Type your answer"
                className="ml-9 border-0 border-b-[1.5px] border-(--st-primary) bg-transparent py-1 outline-none focus-visible:shadow-none"
                value={selected.slice(OTHER_PREFIX.length)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  // Typing in the box must not move the radio selection.
                  if (e.key !== "Enter" && e.key !== "Tab") e.stopPropagation();
                }}
                onChange={(e) => onChange(`${OTHER_PREFIX}${e.target.value}`)}
              />
            )}
          </RadioPrimitive.Item>
        );
      })}
    </RadioPrimitive.Root>
  );
}

function MultiSelect({
  question,
  value,
  onChange,
}: {
  question: Extract<QuestionV1, { type: "multi_select" }>;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const strings = useRuntimeStrings();
  const [beat, pulse] = useBeat();
  const selected = Array.isArray(value) ? (value as string[]) : [];
  const otherEntry = selected.find((v) => v.startsWith(OTHER_PREFIX));
  function toggle(id: string) {
    pulse(id);
    onChange(
      selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id],
    );
  }
  function toggleOther() {
    pulse(OTHER_OPTION_ID);
    onChange(
      otherEntry === undefined
        ? [...selected, OTHER_PREFIX]
        : selected.filter((v) => v !== otherEntry),
    );
  }
  const { minSelections, maxSelections } = question.settings;
  const hint =
    minSelections && maxSelections
      ? `Choose ${minSelections === maxSelections ? minSelections : `${minSelections}–${maxSelections}`}`
      : minSelections
        ? `Choose at least ${minSelections}`
        : maxSelections
          ? `Choose up to ${maxSelections}`
          : strings.chooseMany;
  const options = [
    ...question.settings.options.map((o) => ({
      id: o.id,
      label: o.label,
      checked: selected.includes(o.id),
      onToggle: () => toggle(o.id),
    })),
    ...(question.settings.allowOther
      ? [
          {
            id: OTHER_OPTION_ID,
            label: "Other",
            checked: otherEntry !== undefined,
            onToggle: toggleOther,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-(--st-gap)">
      <div
        role="group"
        aria-label={question.label}
        className="flex max-w-(--st-tile-max) flex-col gap-2"
      >
        {options.map((o, i) => (
          <CheckboxPrimitive.Root
            key={o.id}
            checked={o.checked}
            onCheckedChange={o.onToggle}
            data-key={KEYS[i]}
            data-beat={beat === o.id || undefined}
            className={TILE}
          >
            <span className="flex items-center gap-3">
              <span aria-hidden className={KEY}>
                {o.checked ? "✓" : KEYS[i]}
              </span>
              <span className="flex-1 group-data-[state=checked]/tile:font-semibold">
                {o.label}
              </span>
              {o.checked && (
                <Check aria-hidden className="size-[18px] text-(--st-primary)" />
              )}
            </span>
            {o.id === OTHER_OPTION_ID && otherEntry !== undefined && (
              <input
                autoFocus
                aria-label="Your answer"
                placeholder="Type your answer"
                className="ml-9 border-0 border-b-[1.5px] border-(--st-primary) bg-transparent py-1 outline-none focus-visible:shadow-none"
                value={otherEntry.slice(OTHER_PREFIX.length)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === " ") e.stopPropagation();
                }}
                onChange={(e) =>
                  onChange(
                    selected.map((v) =>
                      v === otherEntry ? `${OTHER_PREFIX}${e.target.value}` : v,
                    ),
                  )
                }
              />
            )}
          </CheckboxPrimitive.Root>
        ))}
      </div>
      <p className="text-[13.5px] text-(--st-muted)">{hint}</p>
    </div>
  );
}

/** A themed dropdown with a type-to-filter box, drawn inline (not in a
 * portal) so it keeps the form's colours. */
function Dropdown({
  options,
  value,
  onChange,
  label,
  autoFocus,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (value: unknown) => void;
  label: string;
  autoFocus: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const chosen = options.find((o) => o.id === value);
  const visible = options.filter((o) =>
    o.label.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  function pick(id: string) {
    onChange(id);
    setOpen(false);
    setFilter("");
    triggerRef.current?.focus();
  }

  return (
    <div className="relative max-w-(--st-tile-max)">
      <button
        ref={triggerRef}
        type="button"
        autoFocus={autoFocus}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={chosen ? `${label}: ${chosen.label}` : label}
        onClick={() => {
          setOpen((o) => !o);
          setActive(
            Math.max(
              0,
              options.findIndex((o) => o.id === value),
            ),
          );
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "flex h-(--st-btn-h) w-full items-center gap-2.5 rounded-(--st-tile-br) border-[1.5px] bg-(--st-field) px-3.5 text-left text-(length:--st-tile)",
          open ? "border-(--st-primary)" : "border-(--st-line)",
          chosen ? "text-(--st-text)" : "text-(--st-muted)",
        )}
      >
        <span className="flex-1 truncate">{chosen?.label ?? "Choose an option"}</span>
        <ChevronDown aria-hidden className="size-[18px] text-(--st-text)" />
      </button>
      {open && (
        <div className="mt-1.5 overflow-hidden rounded-(--st-tile-br) border-[1.5px] border-(--st-line) bg-(--st-field-solid)">
          <label className="flex items-center gap-2 border-b border-(--st-line) px-3.5 py-2.5 text-sm text-(--st-muted)">
            <Search aria-hidden className="size-[15px]" />
            <input
              autoFocus
              value={filter}
              placeholder="Type to filter"
              aria-label="Type to filter"
              aria-controls={listId}
              aria-activedescendant={
                visible[active] ? `${listId}-${visible[active].id}` : undefined
              }
              onChange={(e) => {
                setFilter(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((i) => Math.min(visible.length - 1, i + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(0, i - 1));
                } else if (e.key === "Enter") {
                  // Choosing, not "next question".
                  e.preventDefault();
                  if (visible[active]) pick(visible[active].id);
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  setOpen(false);
                  triggerRef.current?.focus();
                }
              }}
              className="min-w-0 flex-1 bg-transparent text-(--st-text) outline-none placeholder:text-(--st-muted) focus-visible:shadow-none"
            />
          </label>
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="max-h-64 overflow-auto"
          >
            {visible.map((o, i) => (
              <li
                key={o.id}
                id={`${listId}-${o.id}`}
                role="option"
                aria-selected={o.id === value}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o.id)}
                className={cn(
                  "cursor-pointer px-3.5 py-2.5 text-[14.5px]",
                  i === active && "bg-(--st-hover)",
                  o.id === value && "font-semibold",
                )}
              >
                {o.label}
              </li>
            ))}
            {visible.length === 0 && (
              <li className="px-3.5 py-2.5 text-[14.5px] text-(--st-muted)">
                No matches
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function YesNo({
  question,
  value,
  onChange,
}: {
  question: Extract<QuestionV1, { type: "yes_no" }>;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [beat, pulse] = useBeat();
  const choices = [
    { choice: true, key: "Y", label: question.settings.yesLabel || "Yes" },
    { choice: false, key: "N", label: question.settings.noLabel || "No" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={question.label}
      className="grid max-w-(--st-yn-max) grid-cols-2 gap-2.5"
    >
      {choices.map(({ choice, key, label }) => {
        const checked = value === choice;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={checked}
            data-state={checked ? "checked" : "unchecked"}
            data-key={key}
            data-beat={beat === key || undefined}
            onClick={() => {
              pulse(key);
              onChange(choice);
            }}
            className={cn(
              TILE,
              "h-(--st-yn-h) items-center justify-center gap-2.5 text-center font-semibold",
            )}
          >
            <span aria-hidden className={cn(KEY, "size-[26px]")}>
              {key}
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Rating({
  scale,
  value,
  onChange,
}: {
  scale: number;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const rating = typeof value === "number" ? value : 0;
  const [hover, setHover] = useState(0);
  const shown = hover || rating;
  const ten = scale >= 10;
  return (
    <div
      role="radiogroup"
      aria-label="Rating"
      onMouseLeave={() => setHover(0)}
      className={cn("flex flex-nowrap", ten ? "gap-1 sm:gap-2.5" : "gap-2.5")}
    >
      {Array.from({ length: scale }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={rating === n}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          data-key={n <= 9 ? String(n) : undefined}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(n)}
          className="flex flex-col items-center gap-1 rounded-sm"
        >
          <Star
            className={cn(
              ten ? "size-(--st-star-10)" : "size-(--st-star)",
              n <= shown
                ? "fill-(--st-primary) text-(--st-primary)"
                : "fill-(--st-line) text-(--st-line)",
              hover && n <= hover && n > rating && "opacity-55",
            )}
          />
          <span className="text-[11px] text-(--st-muted)">{n}</span>
        </button>
      ))}
    </div>
  );
}

function OpinionScale({
  question,
  value,
  onChange,
}: {
  question: Extract<QuestionV1, { type: "opinion_scale" }>;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [beat, pulse] = useBeat();
  const chosen = typeof value === "number" ? value : undefined;
  const nums = Array.from(
    { length: Math.max(0, question.settings.max - question.settings.min + 1) },
    (_, i) => question.settings.min + i,
  );
  return (
    <div className="flex flex-col gap-2">
      <div
        role="radiogroup"
        aria-label={question.label}
        className="flex gap-(--st-cell-gap)"
      >
        {nums.map((n) => {
          const checked = chosen === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={checked}
              data-key={n >= 0 && n <= 9 ? String(n) : undefined}
              data-beat={beat === String(n) || undefined}
              onClick={() => {
                pulse(String(n));
                onChange(n);
              }}
              className={cn(
                "grid h-(--st-cell-h) min-w-0 flex-1 place-items-center rounded-(--st-cell-br) border-[1.5px] text-(length:--st-cell-font) font-semibold transition-colors data-[beat=true]:[animation:fc-beat_350ms_cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:data-[beat=true]:animate-none",
                checked
                  ? "border-(--st-primary) bg-(--st-primary) text-(--st-on-primary)"
                  : "border-(--st-line) bg-(--st-field) hover:bg-(--st-hover)",
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      {(question.settings.leftLabel || question.settings.rightLabel) && (
        <div className="flex justify-between text-[13px] text-(--st-muted)">
          <span>{question.settings.leftLabel}</span>
          <span>{question.settings.rightLabel}</span>
        </div>
      )}
    </div>
  );
}

function describeAccepted(mimeTypes: string[]): string {
  const labels = mimeTypes.map((t) => {
    if (t === "image/*") return "Images";
    if (t === "application/pdf") return "PDF files";
    if (t.endsWith("/*")) return `${t.slice(0, -2)} files`;
    return t.split("/")[1]?.toUpperCase() ?? t;
  });
  return labels.join(", ");
}

const UPLOAD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function FileUploadInput({
  question,
  value,
  onChange,
  getResponseId,
}: {
  question: Extract<QuestionV1, { type: "file_upload" }>;
  value: unknown;
  onChange: (value: unknown) => void;
  getResponseId?: () => Promise<string>;
}) {
  // After a refresh the answer is just the upload's id (the browser
  // doesn't have the file any more), so never show that as a "name".
  const [fileName, setFileName] = useState<string | null>(
    typeof value === "string" && !UPLOAD_ID_PATTERN.test(value) ? value : null,
  );
  const hasStoredFile = typeof value === "string" && value.length > 0;
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const accepted = describeAccepted(question.settings.acceptedMimeTypes);
  const limits = `${accepted} · up to ${question.settings.maxSizeMb} MB`;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);

    if (!getResponseId) {
      // Preview mode: no network calls at all (see FormRuntime's
      // module doc) — just reflect the filename locally so required-
      // field validation and the visual state behave sensibly.
      onChange(file.name);
      return;
    }

    setStatus("uploading");
    try {
      const responseId = await getResponseId();
      const body = new FormData();
      body.set("file", file);
      const res = await fetch(`/api/responses/${responseId}/uploads/${question.id}`, {
        method: "POST",
        body,
      });
      if (!res.ok) {
        // Keep an earlier successful upload as the answer; only a field
        // with nothing valid in it goes back to empty.
        setStatus("error");
        if (!hasStoredFile) onChange(undefined);
        return;
      }
      const data = (await res.json()) as { uploadId: string };
      setStatus("idle");
      // The answer value is the upload reference id, never the raw
      // file or a public URL — see docs/api.md.
      onChange(data.uploadId);
    } catch {
      setStatus("error");
      if (!hasStoredFile) onChange(undefined);
    }
  }

  const picker = (
    <input
      ref={inputRef}
      type="file"
      accept={question.settings.acceptedMimeTypes.join(",")}
      className="sr-only"
      disabled={status === "uploading"}
      onChange={(e) => {
        void handleFile(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );

  if (status === "uploading") {
    return (
      <div className="flex max-w-(--st-tile-max) flex-col gap-2.5 rounded-(--st-tile-br) border-[1.5px] border-(--st-line) bg-(--st-field) p-4">
        <div className="flex justify-between gap-3 text-[14.5px]">
          <span className="truncate">{fileName}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-(--st-line)">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-(--st-primary)" />
        </div>
        <span className="text-[13px] text-(--st-muted)">
          Uploading… you can keep going.
        </span>
        {picker}
      </div>
    );
  }

  if (hasStoredFile && status !== "error") {
    return (
      <div className="flex max-w-(--st-tile-max) items-center gap-3 rounded-(--st-tile-br) border-[1.5px] border-(--st-primary) bg-(--st-sel) px-4 py-3.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-(--st-primary) text-(--st-on-primary)">
          <FileCheck aria-hidden className="size-[18px]" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-[14.5px]">{fileName ?? "File uploaded"}</b>
          <span className="text-[12.5px] text-(--st-muted)">
            {fileName ? "Uploaded" : "Choose another to replace it"}
          </span>
        </span>
        <label className="cursor-pointer text-[13.5px] font-semibold underline">
          Replace
          {picker}
        </label>
        <button
          type="button"
          aria-label="Remove file"
          onClick={() => {
            setFileName(null);
            onChange(undefined);
          }}
          className="grid size-7 place-items-center rounded-sm"
        >
          <X className="size-[18px]" />
        </button>
      </div>
    );
  }

  const error = status === "error";
  return (
    <div className="flex max-w-(--st-tile-max) flex-col gap-2">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFile(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2 rounded-(--st-tile-br) border-2 border-dashed px-5 py-8 text-center in-data-[mode=phone]:px-4 in-data-[mode=phone]:py-7",
          error
            ? "border-[#c8372d]"
            : dragging
              ? "border-(--st-primary) bg-(--st-sel)"
              : "border-(--st-line) bg-(--st-field)",
        )}
      >
        {error ? (
          <FileX aria-hidden className="size-7 text-[#c8372d]" />
        ) : (
          <Upload aria-hidden className="size-7 text-(--st-primary)" />
        )}
        <span className="text-[15px] font-semibold">
          {error
            ? (fileName ?? "The upload failed")
            : dragging
              ? "Drop it here"
              : "Choose a file or drag it here"}
        </span>
        <span className="text-[13px] text-(--st-muted)">
          {error ? `Choose another file · ${limits}` : limits}
        </span>
        {picker}
      </label>
      {error && <StageError>The upload failed. Try again.</StageError>}
    </div>
  );
}

const CONTACT_INPUT: Record<
  ContactField,
  { type: string; autoComplete: string; placeholder: string }
> = {
  name: { type: "text", autoComplete: "name", placeholder: "Jane Smith" },
  email: { type: "email", autoComplete: "email", placeholder: "jane@company.com" },
  phone: { type: "tel", autoComplete: "tel", placeholder: "+1 555 000 0000" },
  company: { type: "text", autoComplete: "organization", placeholder: "Acme Inc." },
};

/** Lead capture: a few labelled fields on one step. Enter moves to the
 * next field (the last one continues the form, via the runtime's own
 * Enter handling). */
function ContactInfoInput({
  fields,
  requiredFields,
  value,
  onChange,
  autoFocus,
}: {
  fields: ContactField[];
  requiredFields: ContactField[];
  value: unknown;
  onChange: (value: unknown) => void;
  autoFocus: boolean;
}) {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, string>)
      : {};

  return (
    <div className="grid gap-4">
      {fields.map((field, index) => {
        const id = `contact-${field}`;
        const required = requiredFields.includes(field);
        return (
          <div key={field} className="grid gap-1">
            <label htmlFor={id} className="text-[13px] font-semibold text-(--st-muted)">
              {CONTACT_FIELD_LABELS[field]}
              {required ? (
                <span aria-hidden className="text-(--st-primary)">
                  {" "}
                  *
                </span>
              ) : (
                <span className="font-normal"> (optional)</span>
              )}
            </label>
            <input
              id={id}
              autoFocus={autoFocus && index === 0}
              required={required}
              {...CONTACT_INPUT[field]}
              value={record[field] ?? ""}
              onChange={(e) => {
                const next = { ...record, [field]: e.target.value };
                if (!e.target.value) delete next[field];
                onChange(next);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || index === fields.length - 1) return;
                e.preventDefault();
                e.stopPropagation();
                document.getElementById(`contact-${fields[index + 1]}`)?.focus();
              }}
              className={cn(UNDERLINE, "py-1.5 text-[calc(var(--st-input)*0.82)]")}
            />
          </div>
        );
      })}
    </div>
  );
}
