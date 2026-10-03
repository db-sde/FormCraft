"use client";

import { useState, useTransition } from "react";
import { Check, Sparkles } from "lucide-react";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import type { CopilotSuggestion } from "@/domains/ai/response-analysis";
import { Button } from "@/components/ui/button";

export type ReviewForm = () => Promise<
  { ok: true; suggestions: CopilotSuggestion[] } | { ok: false; message: string }
>;

const KIND: Record<CopilotSuggestion["kind"], string> = {
  rewrite: "Reword",
  remove: "Consider removing",
  split: "Asks two things",
  reorder: "Move",
  general: "Whole form",
};

/**
 * Copilot review (P3.2). The AI only suggests: a rewording can be applied
 * with one click (it edits the draft like typing would), everything else
 * is advice with a link to the question.
 */
export function CopilotReview({
  schema,
  enabled,
  review,
  onChange,
  onSelectQuestion,
}: {
  schema: FormSchemaV1;
  enabled: boolean;
  review?: ReviewForm;
  onChange: (patch: Partial<FormSchemaV1>) => void;
  onSelectQuestion?: (questionId: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<CopilotSuggestion[] | null>(null);
  const [applied, setApplied] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!enabled || !review) return null;

  return (
    <section className="border-ink bg-card mt-3 flex flex-col gap-3 rounded-lg border-[1.5px] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-heading flex items-center gap-2 text-base font-bold">
            <Sparkles className="size-4" aria-hidden /> Review with AI
          </h2>
          <p className="text-muted-foreground text-[13px]">
            Suggestions for clearer questions and a shorter form. Nothing changes unless
            you apply it. Uses one AI credit.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            setError(null);
            start(async () => {
              const result = await review();
              if (result.ok) {
                setSuggestions(result.suggestions);
                setApplied(new Set());
              } else setError(result.message);
            });
          }}
        >
          {pending ? "Reviewing…" : suggestions ? "Review again" : "Review my form"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {suggestions && suggestions.length === 0 && (
        <p className="text-sm">No suggestions. The form reads well as it is.</p>
      )}
      {suggestions && suggestions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {suggestions.map((s, i) => {
            const question = s.questionId
              ? schema.questions.find((q) => q.id === s.questionId)
              : undefined;
            return (
              <li
                key={i}
                className="border-border flex flex-col gap-1.5 rounded-lg border p-3 text-[13.5px]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="bg-muted rounded-full px-2 py-0.5 text-[11.5px] font-bold">
                    {KIND[s.kind]}
                  </span>
                  {question && (
                    <button
                      type="button"
                      className="fc-focus text-muted-foreground min-w-0 truncate rounded-xs underline underline-offset-2"
                      onClick={() => onSelectQuestion?.(question.id)}
                    >
                      Question {s.questionNumber}: {question.label || "Untitled"}
                    </button>
                  )}
                </div>
                <p>{s.message}</p>
                {s.newLabel && question && (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="border-primary min-w-0 flex-1 border-l-[3px] pl-2.5 font-semibold">
                      {s.newLabel}
                    </p>
                    {applied.has(i) ? (
                      <span className="flex items-center gap-1 text-[var(--chip-live-fg)]">
                        <Check className="size-4" /> Applied
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => {
                          onChange({
                            questions: schema.questions.map((q) =>
                              q.id === question.id ? { ...q, label: s.newLabel! } : q,
                            ),
                          });
                          setApplied((prev) => new Set(prev).add(i));
                        }}
                      >
                        Apply
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
