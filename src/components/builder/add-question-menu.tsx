"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { QuestionType } from "@/domains/forms/schema/question-types";
import { ADD_GROUPS, QUESTION_TYPE_META, TypeTile } from "./question-meta";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "cn";

/** "Add question" and its two-column menu of types by group (Part 4). */
export function AddQuestionMenu({
  onAdd,
  canAddWelcome,
}: {
  onAdd: (type: QuestionType) => void;
  /** Offer "Welcome screen" (added at the top) when the form has none. */
  canAddWelcome: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
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
        className="shadow-lift grid w-[560px] max-w-[calc(100vw-32px)] grid-cols-2 gap-x-3.5 gap-y-1 rounded-lg p-3.5"
        onKeyDown={(e) => {
          // Arrow keys step through the types, like the menu this replaced.
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
          const items = Array.from(
            e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-type]"),
          );
          const at = items.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? items.length - 1
                : (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          e.preventDefault();
          items[next]?.focus();
        }}
      >
        {ADD_GROUPS.map((group) => {
          const types = group.types.filter(
            (t) => t !== "welcome_screen" || canAddWelcome,
          );
          return (
            <div key={group.name} className="mb-1.5 flex flex-col gap-0.5">
              <span className="text-muted-foreground px-2 py-1 text-[11px] font-bold tracking-[0.1em] uppercase">
                {group.name}
              </span>
              {types.map((type) => {
                const meta = QUESTION_TYPE_META[type];
                return (
                  <button
                    key={type}
                    type="button"
                    data-type={type}
                    onClick={() => {
                      onAdd(type);
                      setOpen(false);
                    }}
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
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
