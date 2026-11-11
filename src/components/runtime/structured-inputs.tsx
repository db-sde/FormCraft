"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from "lucide-react";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import {
  ADDRESS_FIELD_LABELS,
  type AddressField,
} from "@/domains/forms/schema/question-types";
import { cn } from "cn";

const UNDERLINE =
  "fc-input w-full min-w-0 rounded-none border-0 border-b-2 border-(--st-line) bg-transparent py-1.5 text-[calc(var(--st-input)*0.82)] text-(--st-text) outline-none placeholder:text-(--st-muted) focus:border-(--st-primary) focus-visible:shadow-none aria-invalid:border-[#c8372d]";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// --- address (F-13) ---------------------------------------------------------

/** Browser autofill hints, so a saved address fills in with one tap. */
const ADDRESS_AUTOCOMPLETE: Record<AddressField, string> = {
  line1: "address-line1",
  line2: "address-line2",
  city: "address-level2",
  state: "address-level1",
  postalCode: "postal-code",
  country: "country-name",
};

export function AddressInput({
  question,
  value,
  onChange,
  idPrefix,
  autoFocus,
}: {
  question: Extract<QuestionV1, { type: "address" }>;
  value: unknown;
  onChange: (value: unknown) => void;
  idPrefix: string;
  autoFocus?: boolean;
}) {
  const parts = asRecord(value);
  const { fields, requiredFields } = question.settings;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((field, index) => {
        const id = `${idPrefix}-${field}`;
        const required = requiredFields.includes(field);
        const wide = field === "line1" || field === "line2";
        return (
          <div key={field} className={cn("grid gap-1", wide && "sm:col-span-2")}>
            <label htmlFor={id} className="text-[13px] font-semibold text-(--st-muted)">
              {ADDRESS_FIELD_LABELS[field]}
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
              dir="auto"
              autoFocus={autoFocus && index === 0}
              autoComplete={ADDRESS_AUTOCOMPLETE[field]}
              maxLength={200}
              required={required}
              value={typeof parts[field] === "string" ? (parts[field] as string) : ""}
              onChange={(e) => {
                const next = { ...parts, [field]: e.target.value };
                if (!e.target.value) delete next[field];
                onChange(Object.keys(next).length ? next : undefined);
              }}
              onKeyDown={(e) => {
                // Enter moves through the parts; on the last one it reaches
                // the form (next question / page).
                if (e.key !== "Enter" || index === fields.length - 1) return;
                e.preventDefault();
                document.getElementById(`${idPrefix}-${fields[index + 1]}`)?.focus();
              }}
              className={UNDERLINE}
            />
          </div>
        );
      })}
    </div>
  );
}

// --- matrix (F-11) ------------------------------------------------------------

/**
 * Rows rated on the same columns. A table where there's room; on a phone
 * each row becomes its own group of choices, so nothing scrolls sideways.
 * Both are native radios / checkboxes, so keyboard and screen readers
 * work as they do anywhere else.
 */
export function MatrixInput({
  question,
  value,
  onChange,
  idPrefix,
}: {
  question: Extract<QuestionV1, { type: "matrix" }>;
  value: unknown;
  onChange: (value: unknown) => void;
  idPrefix: string;
}) {
  const answers = asRecord(value);
  const { rows, columns, multiple } = question.settings;

  function isChosen(rowId: string, columnId: string) {
    const cell = answers[rowId];
    return Array.isArray(cell) ? cell.includes(columnId) : cell === columnId;
  }
  function choose(rowId: string, columnId: string) {
    const next = { ...answers };
    if (multiple) {
      const cell = Array.isArray(next[rowId]) ? (next[rowId] as string[]) : [];
      const updated = cell.includes(columnId)
        ? cell.filter((c) => c !== columnId)
        : [...cell, columnId];
      if (updated.length) next[rowId] = updated;
      else delete next[rowId];
    } else {
      next[rowId] = columnId;
    }
    onChange(Object.keys(next).length ? next : undefined);
  }
  const type = multiple ? "checkbox" : "radio";
  // Native controls in the form's own colour; the form decides light or
  // dark, not the device.
  const control = "size-[20px] cursor-pointer accent-(--st-primary)";

  return (
    <div className="fc-matrix">
      <table className="w-full border-collapse in-data-[mode=phone]:hidden max-md:in-data-[mode=auto]:hidden">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Row</span>
            </th>
            {columns.map((c) => (
              <th
                key={c.id}
                scope="col"
                className="px-2 pb-2 text-center text-[13px] font-semibold text-(--st-muted)"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-(--st-line)">
              <th
                scope="row"
                className="py-3 pr-3 text-left text-(length:--st-tile) font-medium"
              >
                {row.label}
              </th>
              {columns.map((c) => (
                <td key={c.id} className="px-2 py-3 text-center">
                  <input
                    type={type}
                    name={`${idPrefix}-t-${row.id}`}
                    aria-label={`${row.label}: ${c.label}`}
                    checked={isChosen(row.id, c.id)}
                    onChange={() => choose(row.id, c.id)}
                    className={control}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hidden flex-col gap-4 in-data-[mode=phone]:flex max-md:in-data-[mode=auto]:flex">
        {rows.map((row) => (
          <fieldset key={row.id} className="flex flex-col gap-2">
            <legend className="mb-1 text-(length:--st-tile) font-semibold">
              {row.label}
            </legend>
            <div className="flex flex-wrap gap-2">
              {columns.map((c) => {
                const chosen = isChosen(row.id, c.id);
                return (
                  <label
                    key={c.id}
                    className={cn(
                      "fc-choice flex cursor-pointer items-center gap-2 rounded-(--st-tile-br) border-[1.5px] px-3 py-2 text-[14.5px]",
                      chosen
                        ? "border-(--st-primary) bg-(--st-sel) font-semibold"
                        : "border-(--st-line) bg-(--st-field)",
                    )}
                  >
                    <input
                      type={type}
                      name={`${idPrefix}-s-${row.id}`}
                      checked={chosen}
                      onChange={() => choose(row.id, c.id)}
                      className={control}
                    />
                    {c.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  );
}

// --- ranking (F-18) -------------------------------------------------------------

/**
 * Put options in order. Tap (or Enter / Space on) an option to add it to
 * your ranking; reorder by dragging its handle (mouse, touch or pen) or
 * with its up / down buttons; remove it with ×. With "top N" only N are
 * ranked. The answer is the option ids, best first.
 */
export function RankingInput({
  question,
  value,
  onChange,
  idPrefix,
}: {
  question: Extract<QuestionV1, { type: "ranking" }>;
  value: unknown;
  onChange: (value: unknown) => void;
  idPrefix: string;
}) {
  const options = question.settings.options;
  const needed = question.settings.rankCount ?? options.length;
  const ranked = (Array.isArray(value) ? (value as string[]) : []).filter((id) =>
    options.some((o) => o.id === id),
  );
  const unranked = options.filter((o) => !ranked.includes(o.id));
  const labelOf = (id: string) => options.find((o) => o.id === id)?.label ?? id;
  const full = ranked.length >= needed;
  const [announce, setAnnounce] = useState("");

  function commit(next: string[], message: string) {
    onChange(next.length ? next : undefined);
    setAnnounce(message);
  }
  function move(from: number, to: number) {
    if (to < 0 || to >= ranked.length || from === to) return;
    const next = [...ranked];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    commit(next, `${labelOf(item)} moved to place ${to + 1}.`);
  }

  // Pointer drag: rows reorder live under the pointer. Listeners sit on
  // the window, so the drag survives React moving the row in the DOM.
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const [dragging, setDragging] = useState<string | null>(null);
  const rankedRef = useRef(ranked);
  useEffect(() => {
    rankedRef.current = ranked;
  });
  useEffect(() => {
    if (!dragging) return;
    function onMove(e: PointerEvent) {
      const order = rankedRef.current;
      const from = order.indexOf(dragging!);
      if (from === -1) return;
      let to = from;
      order.forEach((id, i) => {
        const rect = rowRefs.current.get(id)?.getBoundingClientRect();
        if (!rect) return;
        if (i < from && e.clientY < rect.top + rect.height / 2) to = Math.min(to, i);
        if (i > from && e.clientY > rect.top + rect.height / 2) to = Math.max(to, i);
      });
      if (to !== from) {
        const next = [...order];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        rankedRef.current = next;
        onChange(next);
      }
    }
    function onUp() {
      const at = rankedRef.current.indexOf(dragging!);
      setAnnounce(`${labelOf(dragging!)} is in place ${at + 1}.`);
      setDragging(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // labelOf and onChange are stable enough for one drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  const iconButton =
    "grid size-8 shrink-0 place-items-center rounded-(--st-key-br) border border-(--st-line) disabled:opacity-30";

  return (
    <div className="fc-ranking flex max-w-(--st-tile-max) flex-col gap-3">
      <p className="text-[13.5px] text-(--st-muted)" id={`${idPrefix}-hint`}>
        {needed === options.length
          ? "Tap the options in order, best first. Drag or use the arrows to change it."
          : `Tap your top ${needed}, best first. Drag or use the arrows to change it.`}
      </p>
      {ranked.length > 0 && (
        <ol aria-label="Your ranking" className="flex flex-col gap-2">
          {ranked.map((id, index) => (
            <li
              key={id}
              ref={(el) => {
                if (el) rowRefs.current.set(id, el);
                else rowRefs.current.delete(id);
              }}
              className={cn(
                "fc-choice flex items-center gap-2 rounded-(--st-tile-br) border-[1.5px] border-(--st-primary) bg-(--st-sel) py-2 pr-2 pl-1.5 text-(length:--st-tile)",
                dragging === id && "opacity-70 shadow-md",
              )}
            >
              <span
                aria-hidden
                onPointerDown={(e) => {
                  e.preventDefault();
                  setDragging(id);
                }}
                className="grid h-8 w-6 shrink-0 cursor-grab touch-none place-items-center text-(--st-muted)"
              >
                <GripVertical className="size-4" />
              </span>
              <b className="grid size-7 shrink-0 place-items-center rounded-full bg-(--st-primary) text-[13px] text-(--st-on-primary)">
                {index + 1}
              </b>
              <span className="min-w-0 flex-1 font-semibold">{labelOf(id)}</span>
              <button
                type="button"
                aria-label={`Move ${labelOf(id)} up`}
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
                className={iconButton}
              >
                <ArrowUp className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Move ${labelOf(id)} down`}
                disabled={index === ranked.length - 1}
                onClick={() => move(index, index + 1)}
                className={iconButton}
              >
                <ArrowDown className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Remove ${labelOf(id)} from your ranking`}
                onClick={() =>
                  commit(
                    ranked.filter((r) => r !== id),
                    `${labelOf(id)} removed from your ranking.`,
                  )
                }
                className={iconButton}
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ol>
      )}
      {unranked.length > 0 && !full && (
        <ul aria-label="Not ranked yet" className="flex flex-col gap-2">
          {unranked.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                aria-describedby={`${idPrefix}-hint`}
                onClick={() =>
                  commit(
                    [...ranked, option.id],
                    `${option.label} ranked ${ranked.length + 1}.`,
                  )
                }
                className="fc-choice flex w-full items-center gap-3 rounded-(--st-tile-br) border-[1.5px] border-dashed border-(--st-line) bg-(--st-field) px-3 py-2.5 text-left text-(length:--st-tile) hover:bg-(--st-hover)"
              >
                <Plus aria-hidden className="size-4 shrink-0 text-(--st-primary)" />
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
