"use client";

import type { QuestionV1, ThemeV1 } from "@/domains/forms/schema/v1";
import { QuestionPreviewControl } from "./question-preview-control";
import { Textarea } from "@/components/ui/textarea";
import { QUESTION_TYPE_META } from "./question-meta";
import { ThemedButton, ThemedSlide } from "./themed-slide";

const EDITABLE =
  "resize-none border-none bg-transparent px-0 shadow-none placeholder:text-current placeholder:opacity-40 focus-visible:ring-0 dark:bg-transparent";

export function QuestionEditor({
  question,
  theme,
  number,
  onChange,
}: {
  question: QuestionV1;
  theme: ThemeV1;
  /** 1-based position shown to respondents (undefined for screens). */
  number?: number;
  onChange: (next: QuestionV1) => void;
}) {
  const meta = QUESTION_TYPE_META[question.type];
  const Icon = meta.icon;
  const isScreen = question.type === "welcome_screen" || question.type === "statement";

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="text-muted-foreground mb-3 flex items-center gap-2 text-xs font-medium">
        <Icon className="size-3.5" />
        {meta.label}
        {question.required && !isScreen && <span>· Required</span>}
      </div>
      <ThemedSlide theme={theme} className={isScreen ? "items-center text-center" : ""}>
        {isScreen && question.settings.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL
          <img
            src={question.settings.imageUrl}
            alt={question.settings.imageAlt ?? ""}
            className="max-h-48 rounded-lg object-contain"
          />
        )}
        <div className="flex w-full items-start gap-2">
          {number !== undefined && (
            <span className="mt-2.5 shrink-0 text-sm font-medium opacity-60">
              {number} →
            </span>
          )}
          <Textarea
            value={question.label}
            onChange={(e) => onChange({ ...question, label: e.target.value })}
            placeholder="Type your question here"
            aria-label="Question text"
            rows={2}
            className={`${EDITABLE} min-h-0 text-2xl font-semibold md:text-2xl ${isScreen ? "text-center" : ""}`}
          />
        </div>
        <Textarea
          value={question.description ?? ""}
          onChange={(e) => onChange({ ...question, description: e.target.value })}
          placeholder="Add a description (optional)"
          aria-label="Description"
          rows={2}
          className={`${EDITABLE} min-h-0 opacity-75 ${isScreen ? "text-center" : ""}`}
        />
        <div className={isScreen ? "flex justify-center" : "mt-1"}>
          <QuestionPreviewControl question={question} theme={theme} />
        </div>
        {!isScreen && <ThemedButton theme={theme}>OK</ThemedButton>}
      </ThemedSlide>
      <p className="text-muted-foreground mt-3 text-center text-xs">
        Click the text above to edit it. Options and validation are in the panel on the
        right.
      </p>
    </div>
  );
}
