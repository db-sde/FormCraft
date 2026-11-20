"use client";

import { forwardRef } from "react";
import type { CompiledFormV1 } from "@/domains/forms/schema/compile";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { formatAnswerValue } from "@/domains/responses/format";
import { hasAnswer, reviewItems, type AnswerMap } from "@/domains/logic";
import { useRuntimeStrings } from "./runtime-strings";
import { useUploadNames } from "./upload-names";
import { StageActions, StageError, stageDescClass, stageTitleClass } from "./stage";
import { cn } from "cn";

/** An answer as the review shows it: what exports show, except files and
 * signatures (only their names are on the server) and sensitive answers,
 * shown as dots. */
function shownAnswer(
  question: QuestionV1,
  value: unknown,
  strings: { notAnswered: string; fileUploaded: string; signed: string },
  uploadNames: ReadonlyMap<string, string> | null,
): { text: string; empty: boolean } {
  if (!hasAnswer(question, value)) return { text: strings.notAnswered, empty: true };
  if (question.sensitive) return { text: "••••••••", empty: false };
  if (question.type === "file_upload") {
    // Its name when this visit uploaded it (or the Preview's file name).
    const name =
      typeof value === "string"
        ? (uploadNames?.get(value) ?? (/^[0-9a-f-]{36}$/i.test(value) ? null : value))
        : null;
    return { text: name ?? strings.fileUploaded, empty: false };
  }
  if (question.type === "signature") return { text: strings.signed, empty: false };
  if (question.type === "media") {
    return {
      text: question.settings.kind === "video" ? "Video recorded" : "Audio recorded",
      empty: false,
    };
  }
  if (question.type === "consent") {
    const v = value as { acknowledged?: boolean; optIn?: boolean };
    const bits = [
      v.acknowledged ? question.settings.acknowledgeLabel : strings.notAnswered,
    ];
    if (question.settings.optInLabel && v.optIn) bits.push(question.settings.optInLabel);
    return { text: bits.join(" · "), empty: false };
  }
  return {
    text: formatAnswerValue(question, value) || strings.notAnswered,
    empty: false,
  };
}

/**
 * Pre-submission review (F-60): every answer on the way taken, under the
 * form's sections, each with an Edit that goes back to that question.
 * Nothing is submitted until Submit here.
 */
export const ReviewScreen = forwardRef<
  HTMLHeadingElement,
  {
    compiled: CompiledFormV1;
    path: readonly string[];
    answers: AnswerMap;
    onEdit: (questionId: string) => void;
    onBack: () => void;
    onSubmit: () => void;
    submitting: boolean;
    error: string | null;
    recall: (text: string | undefined) => string | undefined;
  }
>(function ReviewScreen(
  { compiled, path, answers, onEdit, onBack, onSubmit, submitting, error, recall },
  headingRef,
) {
  const t = useRuntimeStrings();
  const uploadNames = useUploadNames();
  const items = reviewItems(compiled, path);
  const sections: { title: string | null; items: typeof items }[] = [];
  for (const item of items) {
    const last = sections.at(-1);
    if (last && last.title === item.section) last.items.push(item);
    else sections.push({ title: item.section, items: [item] });
  }

  return (
    <div className="flex flex-col gap-5" data-fc="review">
      <div className="flex flex-col gap-1.5">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className={cn(stageTitleClass, "outline-none focus-visible:shadow-none")}
        >
          {t.reviewTitle}
        </h2>
        <p className={stageDescClass}>{t.reviewIntro}</p>
      </div>
      <div className="flex max-h-[min(460px,55dvh)] flex-col gap-5 overflow-y-auto pe-1">
        {sections.map((section, i) => (
          <section
            key={i}
            aria-label={section.title ?? undefined}
            className="flex flex-col"
          >
            {section.title && (
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-(--st-muted) uppercase">
                {section.title}
              </h3>
            )}
            <dl className="divide-y divide-(--st-line) border-y border-(--st-line)">
              {section.items.map(({ question }) => {
                const label = recall(question.label) || question.label;
                const answer = shownAnswer(
                  question,
                  answers[question.id],
                  t,
                  uploadNames,
                );
                return (
                  <div
                    key={question.id}
                    className="flex items-start gap-3 py-3"
                    data-fc="review-item"
                  >
                    <div className="min-w-0 flex-1">
                      <dt className="text-[13px] font-semibold text-(--st-muted)">
                        {label}
                      </dt>
                      <dd
                        className={cn(
                          "mt-0.5 text-[15px] break-words whitespace-pre-line text-(--st-text)",
                          answer.empty && "text-(--st-muted) italic",
                        )}
                      >
                        {answer.text}
                      </dd>
                    </div>
                    <button
                      type="button"
                      onClick={() => onEdit(question.id)}
                      disabled={submitting}
                      aria-label={`${t.edit}: ${label}`}
                      className="shrink-0 rounded-(--st-br) px-2.5 py-1 text-sm font-semibold text-(--st-primary) underline-offset-2 hover:underline disabled:opacity-50"
                    >
                      {t.edit}
                    </button>
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
      </div>
      {error && <StageError>{error}</StageError>}
      <StageActions
        backLabel={t.back}
        showBack
        onBack={onBack}
        onNext={onSubmit}
        label={t.submit}
        submitting={submitting}
      />
    </div>
  );
});
