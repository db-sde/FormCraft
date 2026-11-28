"use client";

import { useState, type KeyboardEvent, type RefObject } from "react";

export type RecallChoice = { token: string; label: string };

/**
 * The recall menu for a builder text field (QA FC15-41): typing "@"
 * offers earlier answers, scores and URL fields, and picking one puts
 * its placeholder ({{answer:…}}) where the "@" was. Escape, or typing
 * on, keeps the "@" as written.
 */
export function useRecallMenu({
  ref,
  value,
  choices,
  onPick,
}: {
  ref: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  value: string;
  choices: RecallChoice[];
  onPick: (next: string) => void;
}) {
  // Where the "@" is, and what's been typed after it.
  const [at, setAt] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  // What's typed after the "@", up to the next space (which closes it).
  const query = at === null ? "" : (value.slice(at + 1).split(/\s/)[0] ?? "");
  const shown =
    at === null
      ? []
      : choices
          .filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 8);

  function pick(choice: RecallChoice) {
    if (at === null) return;
    const end = at + 1 + query.length;
    const next = value.slice(0, at) + choice.token + value.slice(end);
    setAt(null);
    onPick(next);
    const caret = at + choice.token.length;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(caret, caret);
    });
  }

  /** Call from the field's onChange, after updating the value. */
  function onInput(next: string, caret: number | null) {
    if (caret === null || choices.length === 0) return setAt(null);
    const typed = next[caret - 1];
    const before = caret >= 2 ? next[caret - 2] : " ";
    if (typed === "@" && /\s|^$/.test(before ?? " ")) {
      setAt(caret - 1);
      setActive(0);
    } else if (at !== null) {
      // Closed once the "@" is gone, or a space ends the search.
      if (next[at] !== "@" || caret <= at || /\s/.test(next.slice(at + 1, caret)))
        setAt(null);
    }
  }

  /** Call first from the field's onKeyDown; true when it handled the key. */
  function onKeyDown(e: KeyboardEvent): boolean {
    if (at === null || shown.length === 0) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + shown.length) % shown.length);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(shown[Math.min(active, shown.length - 1)]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setAt(null);
      return true;
    }
    return false;
  }

  const menu =
    at !== null && shown.length > 0 ? (
      <ul
        role="listbox"
        aria-label="Insert an answer"
        className="border-ink bg-card text-foreground absolute z-30 mt-1 max-h-64 w-72 overflow-y-auto rounded-md border-[1.5px] p-1 text-[13px] shadow-md"
      >
        {shown.map((choice, i) => (
          <li
            key={choice.token}
            role="option"
            aria-selected={i === active}
            className={`cursor-pointer truncate rounded-sm px-2 py-1.5 ${
              i === active ? "bg-accent" : ""
            }`}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(choice);
            }}
            onMouseEnter={() => setActive(i)}
          >
            {choice.label}
          </li>
        ))}
      </ul>
    ) : null;

  return { menu, onInput, onKeyDown, open: menu !== null };
}
