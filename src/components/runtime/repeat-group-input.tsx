"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { nanoid } from "nanoid";
import { Plus, X } from "lucide-react";
import type { GroupFieldV1, QuestionV1 } from "@/domains/forms/schema/v1";
import {
  entryName,
  entryWord,
  fieldAsQuestion,
  fieldVisible,
  groupEntries,
  type GroupEntry,
} from "@/domains/forms/repeat-group";
import { cn } from "cn";

type RepeatGroupQuestion = Extract<QuestionV1, { type: "repeat_group" }>;

const newEntry = (): GroupEntry => ({ id: `e_${nanoid(10)}`, values: {} });

/**
 * A repeatable group (F-56): one card per entry, each with the group's
 * fields, Add another (up to the most allowed) and Remove (down to the
 * fewest). Fields a card's own answers hide are left out of that card.
 * Each field is drawn by the same input as a question of its type
 * (`renderField`), so it looks and behaves the same.
 */
export function RepeatGroupInput({
  question,
  value,
  onChange,
  idPrefix,
  autoFocus,
  renderField,
}: {
  question: RepeatGroupQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
  idPrefix: string;
  autoFocus?: boolean;
  renderField: (props: {
    question: QuestionV1;
    value: unknown;
    onChange: (value: unknown) => void;
    idPrefix: string;
    autoFocus: boolean;
  }) => ReactNode;
}) {
  const { fields, minEntries, maxEntries } = question.settings;
  const stored = groupEntries(value);
  const entries =
    stored.length > 0
      ? stored
      : Array.from({ length: Math.max(1, minEntries) }, newEntry);
  // Start with the fewest entries in the answer, so each keeps its id.
  const seeded = useRef(stored.length > 0);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    onChange(entries);
    // Once, on first show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    if (!focusNext.current) return;
    document
      .querySelector<HTMLElement>(
        `[data-entry="${CSS.escape(focusNext.current)}"] :is(input, textarea, select, button[role="combobox"])`,
      )
      ?.focus();
    focusNext.current = null;
  });

  function update(next: GroupEntry[]) {
    onChange(next);
  }
  function setField(entryId: string, field: GroupFieldV1, v: unknown) {
    update(
      entries.map((e) => {
        if (e.id !== entryId) return e;
        const values = { ...e.values, [field.id]: v };
        if (v === undefined || v === "") delete values[field.id];
        return { ...e, values };
      }),
    );
  }

  const canAdd = entries.length < maxEntries;
  const canRemove = entries.length > Math.max(1, minEntries);
  const add =
    question.settings.addLabel?.trim() ||
    `Add another ${entryWord(question.settings.entryLabel)}`;

  return (
    <div className="flex flex-col gap-3" data-fc="repeat-group">
      {entries.map((entry, index) => {
        const name = entryName(question, index);
        const shown = fields.filter((f) => fieldVisible(f, entry.values, fields));
        return (
          <fieldset
            key={entry.id}
            data-fc="group-entry"
            data-entry={entry.id}
            className="relative flex flex-col gap-3 rounded-(--st-tile-br) border-[1.5px] border-(--st-line) px-4 pt-2 pb-4"
          >
            <legend className="px-1 text-[13px] font-semibold text-(--st-muted)">
              {name}
            </legend>
            {canRemove && (
              <button
                type="button"
                onClick={() => update(entries.filter((e) => e.id !== entry.id))}
                aria-label={`Remove ${name}`}
                className="absolute top-1.5 right-2 grid size-7 place-items-center rounded-full text-(--st-muted) hover:bg-(--st-line)"
              >
                <X className="size-4" />
              </button>
            )}
            {shown.map((field, fi) => {
              const id = `${idPrefix}-${entry.id}-${field.id}`;
              const asQuestion = fieldAsQuestion(question, field, entry.id);
              return (
                <div key={field.id} className="grid gap-1">
                  <span
                    id={`${id}-label`}
                    className="text-[13px] font-semibold text-(--st-text)"
                  >
                    {field.label}
                    {field.required ? (
                      <span aria-hidden className="text-(--st-primary)">
                        {" "}
                        *
                      </span>
                    ) : (
                      <span className="font-normal text-(--st-muted)"> (optional)</span>
                    )}
                  </span>
                  {field.type === "yes_no" ? (
                    <div
                      role="radiogroup"
                      aria-labelledby={`${id}-label`}
                      className="flex gap-2"
                    >
                      {[true, false].map((choice) => (
                        <label
                          key={String(choice)}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-(--st-tile-br) border-[1.5px] px-3 py-1.5 text-[15px]",
                            entry.values[field.id] === choice
                              ? "border-(--st-primary)"
                              : "border-(--st-line)",
                          )}
                        >
                          <input
                            type="radio"
                            name={id}
                            checked={entry.values[field.id] === choice}
                            onChange={() => setField(entry.id, field, choice)}
                            className="accent-(--st-primary)"
                          />
                          {choice ? "Yes" : "No"}
                        </label>
                      ))}
                    </div>
                  ) : (
                    renderField({
                      question: { ...asQuestion, label: `${name}: ${field.label}` },
                      value: entry.values[field.id],
                      onChange: (v) => setField(entry.id, field, v),
                      idPrefix: id,
                      autoFocus: !!autoFocus && index === 0 && fi === 0,
                    })
                  )}
                </div>
              );
            })}
          </fieldset>
        );
      })}
      {canAdd && (
        <button
          type="button"
          onClick={() => {
            const entry = newEntry();
            focusNext.current = entry.id;
            update([...entries, entry]);
          }}
          className="flex w-fit items-center gap-1.5 rounded-(--st-br) border-[1.5px] border-dashed border-(--st-line) px-3.5 py-2 text-sm font-semibold text-(--st-primary) hover:border-(--st-primary)"
        >
          <Plus className="size-4" />
          {add}
        </button>
      )}
    </div>
  );
}
