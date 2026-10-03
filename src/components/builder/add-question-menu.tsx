"use client";

import { useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import type { QuestionType } from "@/domains/forms/schema/question-types";
import { ADD_GROUPS, QUESTION_TYPE_META, TypeTile } from "./question-meta";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "cn";

/**
 * "Add question" and its two-column menu of types by group (Part 4).
 * Opens with the search field focused, so a type is a few keystrokes
 * and Enter away ("em" ↵ → Email); the arrow keys step through the list.
 */
export function AddQuestionMenu({
  onAdd,
  canAddWelcome,
}: {
  onAdd: (type: QuestionType) => void;
  /** Offer "Welcome screen" (added at the top) when the form has none. */
  canAddWelcome: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Set when a type was picked: focus then belongs to the new question's
  // text, not back on this button.
  const pickedRef = useRef(false);

  const needle = query.trim().toLowerCase();
  /** How well a type matches the search: its name first, then what it
   * says about itself. Null = no match. */
  const rank = (type: QuestionType, groupName: string): number | null => {
    if (!needle) return 0;
    const meta = QUESTION_TYPE_META[type];
    const label = meta.label.toLowerCase();
    if (label.startsWith(needle)) return 0;
    if (label.split(/[^a-z0-9]+/).some((word) => word.startsWith(needle))) return 1;
    if (label.includes(needle)) return 2;
    return `${meta.description} ${groupName}`.toLowerCase().includes(needle) ? 3 : null;
  };
  const groups = ADD_GROUPS.map((group) => ({
    name: group.name,
    types: group.types.filter(
      (type) =>
        (type !== "welcome_screen" || canAddWelcome) && rank(type, group.name) !== null,
    ),
  })).filter((group) => group.types.length > 0);
  // What Enter adds: the best match (ties go to the one listed first).
  const first = groups
    .flatMap((group) =>
      group.types.map((type) => ({ type, score: rank(type, group.name)! })),
    )
    .sort((a, b) => a.score - b.score)[0]?.type;

  function pick(type: QuestionType) {
    pickedRef.current = true;
    onAdd(type);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          pickedRef.current = false;
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-add-question
          className={cn(
            "fc-focus border-ink hover:bg-hover-wash mt-1.5 flex h-10 w-full items-center justify-center gap-2 rounded-sm border-[1.5px] border-dashed text-sm font-bold",
            open && "bg-accent hover:bg-accent",
          )}
        >
          <Plus className="size-4" /> Add question
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={18}
        className="shadow-lift flex w-[560px] max-w-[calc(100vw-32px)] flex-col gap-2 rounded-lg p-3.5"
        onCloseAutoFocus={(e) => {
          if (pickedRef.current) e.preventDefault();
        }}
        onKeyDown={(e) => {
          // Arrow keys step through the types, like the menu this replaced.
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
          const items = Array.from(
            e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-type]"),
          );
          if (items.length === 0) return;
          const at = items.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? items.length - 1
                : at === -1
                  ? e.key === "ArrowDown"
                    ? 0
                    : items.length - 1
                  : (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          e.preventDefault();
          items[next]?.focus();
        }}
      >
        <label className="border-input focus-within:border-ink flex h-9 items-center gap-2 rounded-sm border-[1.5px] px-2.5">
          <Search className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && first) {
                e.preventDefault();
                pick(first);
              }
            }}
            placeholder="Search question types"
            aria-label="Search question types"
            className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {needle && first && (
            <span className="text-muted-foreground shrink-0 text-xs">
              ↵ {QUESTION_TYPE_META[first].label}
            </span>
          )}
        </label>
        {groups.length === 0 ? (
          <p className="text-muted-foreground px-2 py-3 text-sm">
            No question type matches “{query.trim()}”.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-3.5 gap-y-1">
            {groups.map((group) => (
              <div key={group.name} className="mb-1.5 flex flex-col gap-0.5">
                <span className="text-muted-foreground px-2 py-1 text-[11px] font-bold tracking-[0.1em] uppercase">
                  {group.name}
                </span>
                {group.types.map((type) => {
                  const meta = QUESTION_TYPE_META[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      data-type={type}
                      onClick={() => pick(type)}
                      className="fc-focus hover:bg-accent flex items-center gap-2.5 rounded-sm px-2 py-[7px] text-left"
                    >
                      <TypeTile type={type} size={30} />
                      <span className="flex flex-col leading-tight">
                        <b className="text-[13.5px]">{meta.label}</b>
                        <span className="text-muted-foreground text-xs">
                          {meta.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
