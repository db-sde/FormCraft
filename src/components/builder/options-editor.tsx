"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X, GripVertical } from "lucide-react";
import type { OptionV1 } from "@/domains/forms/schema/v1";
import { createOption } from "@/domains/forms/builder";
import { Input } from "@/components/ui/input";
import { cn } from "cn";

const KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Placeholder wording a new option starts with; typing replaces it. */
const isPlaceholder = (label: string) => /^Option \d+$/.test(label);

/** Options for a choice question (Part 4): drag to reorder, letter keys
 * as respondents see them, and pasting several lines adds one option
 * per line. Built for typing a list without the mouse: Enter adds the
 * next option, Backspace on an empty one removes it, the arrow keys move
 * between them. Option ids are stable — reordering never re-creates them. */
export function OptionsEditor({
  options,
  onChange,
}: {
  options: OptionV1[];
  onChange: (options: OptionV1[]) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  // The option to focus once it has rendered (one just added, or the
  // neighbour of one just removed). Checked after every render.
  const pendingFocus = useRef<string | null>(null);
  // A click that focuses placeholder wording keeps it selected (the
  // browser would otherwise drop the selection on mouse-up).
  const keepSelection = useRef(false);
  // An option made by pressing Enter: if it's left as it came, it goes
  // away again, so ending a list with Enter leaves nothing behind.
  const tentative = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    const input = inputs.current.get(id);
    if (!input) return;
    pendingFocus.current = null;
    input.focus();
    if (isPlaceholder(input.value)) input.select();
  });

  function updateLabel(id: string, label: string) {
    onChange(options.map((o) => (o.id === id ? { ...o, label } : o)));
  }

  function remove(id: string) {
    if (options.length <= 1) return;
    onChange(options.filter((o) => o.id !== id));
  }

  /** Adds an option after `index` (at the end by default) and focuses it. */
  function add(index = options.length - 1) {
    const option = createOption(`Option ${options.length + 1}`);
    const next = [...options];
    next.splice(index + 1, 0, option);
    onChange(next);
    pendingFocus.current = option.id;
    return option.id;
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      // Enter on an option nobody typed in means "that's the list".
      if (
        tentative.current === options[index].id &&
        isPlaceholder(e.currentTarget.value)
      ) {
        e.currentTarget.blur();
        return;
      }
      // On to the next option: an unedited one that's already there, or
      // a new one.
      const following = options[index + 1];
      if (following && isPlaceholder(following.label)) {
        const input = inputs.current.get(following.id);
        input?.focus();
        input?.select();
      } else {
        tentative.current = add(index);
      }
    } else if (
      e.key === "Backspace" &&
      e.currentTarget.value === "" &&
      options.length > 1
    ) {
      e.preventDefault();
      pendingFocus.current = options[index === 0 ? 1 : index - 1].id;
      remove(options[index].id);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const to = options[index + (e.key === "ArrowDown" ? 1 : -1)];
      if (!to) return;
      e.preventDefault();
      inputs.current.get(to.id)?.focus();
    }
  }

  function move(from: number, to: number) {
    if (from === to) return;
    const next = [...options];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }

  function handlePaste(index: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const lines = e.clipboardData
      .getData("text")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) return;
    e.preventDefault();
    const [first, ...rest] = lines;
    const next = [...options];
    next[index] = { ...next[index], label: first };
    next.splice(index + 1, 0, ...rest.map((label) => createOption(label)));
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {options.map((option, index) => (
        <div
          key={option.id}
          onDragOver={(e) => {
            if (dragIndex === null) return;
            e.preventDefault();
            if (overIndex !== index) setOverIndex(index);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragIndex !== null) move(dragIndex, index);
            setDragIndex(null);
            setOverIndex(null);
          }}
          className={cn(
            "flex items-center gap-1.5 rounded-[2px]",
            dragIndex !== null &&
              overIndex === index &&
              dragIndex !== index &&
              "shadow-[inset_0_3px_0_var(--primary)]",
            dragIndex === index && "opacity-50",
          )}
        >
          <span
            draggable
            onDragStart={(e) => {
              setDragIndex(index);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            aria-hidden
            className="text-subtle-foreground cursor-grab"
          >
            <GripVertical className="size-3.5" />
          </span>
          <span
            aria-hidden
            className="border-input text-muted-foreground grid size-[22px] shrink-0 place-items-center rounded-[5px] border-[1.5px] text-[11px] font-bold"
          >
            {KEYS[index] ?? "·"}
          </span>
          <Input
            ref={(el) => {
              if (el) inputs.current.set(option.id, el);
              else inputs.current.delete(option.id);
            }}
            data-option-input
            value={option.label}
            onChange={(e) => updateLabel(option.id, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            // Placeholder wording is replaced by typing, not edited.
            onFocus={(e) => {
              if (!isPlaceholder(e.currentTarget.value)) return;
              e.currentTarget.select();
              keepSelection.current = true;
            }}
            onMouseUp={(e) => {
              if (keepSelection.current) e.preventDefault();
              keepSelection.current = false;
            }}
            onBlur={(e) => {
              keepSelection.current = false;
              if (tentative.current !== option.id) return;
              tentative.current = null;
              if (isPlaceholder(e.currentTarget.value)) remove(option.id);
            }}
            onPaste={(e) => handlePaste(index, e)}
            aria-label={`Option ${index + 1}`}
            className="h-9 min-w-0 flex-1 px-2.5 text-sm"
          />
          <button
            type="button"
            disabled={options.length <= 1}
            aria-label={`Remove option ${index + 1}`}
            onClick={() => remove(option.id)}
            className="fc-focus text-muted-foreground hover:bg-hover-wash grid size-7 shrink-0 place-items-center rounded-sm disabled:opacity-30"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => add()}
        className="fc-focus border-ink hover:bg-hover-wash flex h-8 items-center gap-1.5 self-start rounded-sm border-[1.5px] border-dashed px-2.5 text-[13px] font-semibold"
      >
        <Plus className="size-[13px]" /> Add option
      </button>
      <p className="text-muted-foreground text-[12px]">
        Press Enter for the next option, or paste a list.
      </p>
    </div>
  );
}
