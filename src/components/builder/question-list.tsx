"use client";

import { ChevronUp, ChevronDown, Copy, Trash2 } from "lucide-react";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { QUESTION_TYPE_META } from "./question-meta";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

export function QuestionList({
  questions,
  selectedId,
  onSelect,
  onMove,
  onDuplicate,
  onDelete,
}: {
  questions: QuestionV1[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const hasWelcome = questions[0]?.type === "welcome_screen";

  return (
    <ol className="flex flex-col gap-1" aria-label="Questions">
      {questions.map((question, index) => {
        const meta = QUESTION_TYPE_META[question.type];
        const Icon = meta.icon;
        const selected = question.id === selectedId;
        // The welcome screen is pinned first — see isWelcomeScreen.
        const pinned = question.type === "welcome_screen";

        return (
          <li key={question.id}>
            <div
              className={cn(
                "group flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm",
                selected
                  ? "border-foreground/20 bg-accent"
                  : "hover:bg-accent/50 border-transparent",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(question.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                aria-current={selected}
              >
                <span className="text-muted-foreground w-4 shrink-0 text-right text-xs tabular-nums">
                  {index + 1}
                </span>
                <Icon className="text-muted-foreground size-4 shrink-0" />
                <span className="truncate">{question.label || meta.label}</span>
              </button>

              {/* Always in the DOM (and tab order) — opacity, not
                  display:none, so keyboard users can Tab to these
                  without needing to hover first. */}
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-within:opacity-100">
                {!pinned && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      disabled={index === 0 || (index === 1 && hasWelcome)}
                      aria-label={`Move "${question.label}" up`}
                      onClick={() => onMove(question.id, "up")}
                    >
                      <ChevronUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      disabled={index === questions.length - 1}
                      aria-label={`Move "${question.label}" down`}
                      onClick={() => onMove(question.id, "down")}
                    >
                      <ChevronDown className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label={`Duplicate "${question.label}"`}
                      onClick={() => onDuplicate(question.id)}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </>
                )}
                {questions.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive size-6"
                    aria-label={`Delete "${question.label}"`}
                    onClick={() => onDelete(question.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
