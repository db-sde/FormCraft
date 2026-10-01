"use client";

import { useState } from "react";
import { Plus, X, GripVertical } from "lucide-react";
import type { OptionV1 } from "@/domains/forms/schema/v1";
import { createOption } from "@/domains/forms/builder";
import { Input } from "@/components/ui/input";
import { cn } from "cn";

const KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Options for a choice question (Part 4): drag to reorder, letter keys
 * as respondents see them, and pasting several lines adds one option
 * per line. Option ids are stable — reordering never re-creates them. */
export function OptionsEditor({
  options,
  onChange,
}: {
  options: OptionV1[];
  onChange: (options: OptionV1[]) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  function updateLabel(id: string, label: string) {
    onChange(options.map((o) => (o.id === id ? { ...o, label } : o)));
  }

  function remove(id: string) {
    if (options.length <= 1) return;
    onChange(options.filter((o) => o.id !== id));
  }

  function add() {
    onChange([...options, createOption(`Option ${options.length + 1}`)]);
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
            value={option.label}
            onChange={(e) => updateLabel(option.id, e.target.value)}
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
        onClick={add}
        className="fc-focus border-ink hover:bg-hover-wash flex h-8 items-center gap-1.5 self-start rounded-sm border-[1.5px] border-dashed px-2.5 text-[13px] font-semibold"
      >
        <Plus className="size-[13px]" /> Add option
      </button>
    </div>
  );
}
