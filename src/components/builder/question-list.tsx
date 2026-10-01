"use client";

import { useState } from "react";
import { ChevronUp, ChevronDown, Copy, GripVertical, Trash2 } from "lucide-react";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { QUESTION_TYPE_META, TypeTile } from "./question-meta";
import { cn } from "cn";

const ROW_ACTION =
  "fc-focus grid size-6 place-items-center rounded-xs hover:bg-hover-wash-strong disabled:opacity-30";

/** The builder's question list (Part 4): numbered rows with type tiles;
 * the selected row is ink with its actions. Drag a row by its grip, or
 * use the arrows, to reorder. The welcome screen is pinned first. */
export function QuestionList({
  questions,
  selectedId,
  invalidId,
  onSelect,
  onMove,
  onReorder,
  onDuplicate,
  onDelete,
}: {
  questions: QuestionV1[];
  selectedId: string | null;
  /** The question whose setting stops the draft saving. */
  invalidId?: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const hasWelcome = questions[0]?.type === "welcome_screen";
  const firstMovable = hasWelcome ? 1 : 0;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const hasWelcomeOffset = hasWelcome ? 0 : 1;

  return (
    <ol className="flex flex-col gap-0.5" aria-label="Questions">
      {questions.map((question, index) => {
        const meta = QUESTION_TYPE_META[question.type];
        const selected = question.id === selectedId;
        // The welcome screen is pinned first — see isWelcomeScreen.
        const pinned = question.type === "welcome_screen";
        // Respondent-facing numbers skip the pinned welcome screen.
        const number = index + hasWelcomeOffset;
        const label = question.label || meta.label;

        return (
          <li
            key={question.id}
            onDragOver={(e) => {
              if (dragIndex === null || index < firstMovable) return;
              e.preventDefault();
              if (overIndex !== index) setOverIndex(index);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null && index >= firstMovable)
                onReorder(dragIndex, index);
              setDragIndex(null);
              setOverIndex(null);
            }}
            className={cn(
              "group relative flex h-10 items-center gap-2 rounded-sm pr-1.5 pl-1",
              selected ? "bg-secondary text-secondary-foreground" : "hover:bg-hover-wash",
              dragIndex === index && "opacity-50",
              dragIndex !== null &&
                overIndex === index &&
                dragIndex !== index &&
                (dragIndex < index
                  ? "shadow-[inset_0_-3px_0_var(--primary)]"
                  : "shadow-[inset_0_3px_0_var(--primary)]"),
            )}
          >
            <span
              draggable={!pinned}
              onDragStart={(e) => {
                setDragIndex(index);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", question.id);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              aria-hidden
              className={cn(
                "relative w-3 shrink-0",
                pinned
                  ? "invisible"
                  : selected
                    ? "cursor-grab text-[#9a8c7a]"
                    : "text-subtle-foreground cursor-grab opacity-0 group-hover:opacity-100",
              )}
            >
              <GripVertical className="h-4 w-3" />
            </span>
            <button
              type="button"
              onClick={() => onSelect(question.id)}
              aria-current={selected || undefined}
              className="focus-visible:after:shadow-focus flex min-w-0 flex-1 items-center gap-2 self-stretch text-left outline-none after:absolute after:inset-0 after:rounded-sm"
            >
              <span className="w-[18px] shrink-0 text-right text-xs font-bold tabular-nums">
                {pinned ? "" : number}
              </span>
              <TypeTile type={question.type} size={24} />
              <span
                className={cn(
                  "truncate text-[13.5px]",
                  selected ? "font-bold" : "font-medium",
                )}
              >
                {label}
              </span>
            </button>
            {invalidId === question.id && (
              <span
                title="Has an invalid setting"
                className="bg-destructive relative size-2 shrink-0 rounded-full shadow-[0_0_0_2px_var(--card)]"
              >
                <span className="sr-only">Has an invalid setting</span>
              </span>
            )}

            {/* Shown on the selected row; on others they appear on hover or
                when the row has keyboard focus (Tab from the row reaches
                them), so long labels keep their room otherwise. */}
            <span
              className={cn(
                "relative shrink-0 gap-px",
                selected ? "flex" : "hidden group-focus-within:flex group-hover:flex",
              )}
            >
              {!pinned && (
                <>
                  <button
                    type="button"
                    className={ROW_ACTION}
                    disabled={index <= firstMovable}
                    aria-label={`Move "${label}" up`}
                    title="Move up"
                    onClick={() => onMove(question.id, "up")}
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className={ROW_ACTION}
                    disabled={index === questions.length - 1}
                    aria-label={`Move "${label}" down`}
                    title="Move down"
                    onClick={() => onMove(question.id, "down")}
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className={ROW_ACTION}
                    aria-label={`Duplicate "${label}"`}
                    title="Duplicate"
                    onClick={() => onDuplicate(question.id)}
                  >
                    <Copy className="size-[13px]" />
                  </button>
                </>
              )}
              {questions.length > 1 && (
                <button
                  type="button"
                  className={cn(
                    ROW_ACTION,
                    selected ? "text-[#ff8a7a]" : "text-destructive",
                  )}
                  aria-label={`Delete "${label}"`}
                  title="Delete"
                  onClick={() => onDelete(question.id)}
                >
                  <Trash2 className="size-[13px]" />
                </button>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
