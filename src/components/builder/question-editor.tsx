"use client";

import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { QuestionPreviewControl } from "./question-preview-control";
import { Textarea } from "@/components/ui/textarea";
import { QUESTION_TYPE_META } from "./question-meta";

export function QuestionEditor({
  question,
  onChange,
}: {
  question: QuestionV1;
  onChange: (next: QuestionV1) => void;
}) {
  const meta = QUESTION_TYPE_META[question.type];

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {meta.label}
      </span>
      <Textarea
        value={question.label}
        onChange={(e) => onChange({ ...question, label: e.target.value })}
        placeholder="Question text"
        aria-label="Question text"
        rows={2}
        className="resize-none border-none px-0 text-2xl font-semibold shadow-none focus-visible:ring-0 md:text-2xl"
      />
      <Textarea
        value={question.description ?? ""}
        onChange={(e) => onChange({ ...question, description: e.target.value })}
        placeholder="Description (optional)"
        aria-label="Description"
        rows={2}
        className="text-muted-foreground resize-none border-none px-0 shadow-none focus-visible:ring-0"
      />
      <div className="mt-2">
        <QuestionPreviewControl question={question} />
      </div>
    </div>
  );
}
