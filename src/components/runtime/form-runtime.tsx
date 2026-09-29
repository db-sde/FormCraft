"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import type { CompiledFormV1 } from "@/domains/forms/schema/compile";
import type { EndingV1, QuestionV1 } from "@/domains/forms/schema/v1";
import {
  evaluateNextStep,
  validateAnswer,
  OTHER_PREFIX,
  type AnswerMap,
} from "@/domains/logic";
import { RuntimeQuestionInput } from "./runtime-question-input";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { THEME_FONT_STACK, THEME_BUTTON_RADIUS } from "@/components/theme-styles";

export type CompleteOutcome =
  | { ok: true; endingId: string }
  | { ok: false; message: string; errors?: { questionId: string; message: string }[] };

/** Choosing one of these is a complete answer on its own, so the form
 * moves on by itself (as Typeform does) instead of making the
 * respondent also press OK. */
const AUTO_ADVANCE_TYPES = new Set<QuestionV1["type"]>([
  "single_select",
  "yes_no",
  "rating",
  "opinion_scale",
  "dropdown",
]);
const AUTO_ADVANCE_DELAY_MS = 350;

function isEntryScreen(question: QuestionV1) {
  return question.type === "welcome_screen" || question.type === "statement";
}

/**
 * Conversational (one-question-at-a-time) respondent experience.
 * Shared by the builder's Preview dialog (fed the in-memory draft
 * schema, no persistence) and the public runtime at /f/[slug] (fed
 * the published schema, wired to the response-autosave/submission API
 * by its caller via `onAnswerChange`/`onComplete`) — same component,
 * same navigation/validation/logic engine, so behavior can't drift
 * between what a creator previews and what a respondent actually sees
 * (ARCHITECTURE.md).
 *
 * This component itself never makes a network call. When `onComplete`
 * is given, the ending is only shown once it resolves `ok` — so a
 * rejected or failed submission is surfaced to the respondent instead
 * of being hidden behind a "thanks" screen.
 */
export function FormRuntime({
  compiled,
  initialAnswers,
  initialQuestionId,
  initialHistory,
  onAnswerChange,
  onComplete,
  responseId,
  className,
}: {
  compiled: CompiledFormV1;
  initialAnswers?: AnswerMap;
  initialQuestionId?: string;
  initialHistory?: string[];
  /** Only present in the real public runtime — see
   * runtime-question-input.tsx's FileUploadInput for why. */
  responseId?: string;
  onAnswerChange?: (answers: AnswerMap, currentQuestionId: string) => void;
  onComplete?: (answers: AnswerMap) => Promise<CompleteOutcome>;
  /** Layout for the outer container — e.g. `min-h-dvh` on the public
   * page so the theme background covers the whole viewport. */
  className?: string;
}) {
  const [currentId, setCurrentId] = useState(
    initialQuestionId && compiled.orderedQuestionIds.includes(initialQuestionId)
      ? initialQuestionId
      : compiled.orderedQuestionIds[0],
  );
  const [answers, setAnswers] = useState<AnswerMap>(initialAnswers ?? {});
  const [history, setHistory] = useState<string[]>(initialHistory ?? []);
  const [ending, setEnding] = useState<EndingV1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const theme = compiled.schema.theme;
  const question = compiled.schema.questions.find((q) => q.id === currentId);
  const currentIndex = compiled.orderedQuestionIds.indexOf(currentId);
  const isLastStep =
    question !== undefined &&
    evaluateNextStep(compiled, question.id, answers).type === "ending";

  async function finish(finalAnswers: AnswerMap, endingId: string) {
    if (!onComplete) {
      setEnding(compiled.schema.endings.find((e) => e.id === endingId) ?? null);
      return;
    }

    setSubmitting(true);
    const outcome = await onComplete(finalAnswers);
    setSubmitting(false);

    if (outcome.ok) {
      const serverEnding =
        compiled.schema.endings.find((e) => e.id === outcome.endingId) ??
        compiled.schema.endings.find((e) => e.id === endingId);
      setEnding(serverEnding ?? null);
      return;
    }

    // Send the respondent back to the first question the server
    // rejected, with its message — instead of a vague banner on the
    // last screen about something they answered pages ago.
    const firstError = outcome.errors?.[0];
    if (firstError && firstError.questionId !== currentId) {
      const index = history.indexOf(firstError.questionId);
      if (index >= 0) setHistory((h) => h.slice(0, index));
      setCurrentId(firstError.questionId);
      setError(firstError.message);
      return;
    }
    setError(firstError?.message ?? outcome.message);
  }

  function goNext(currentAnswers: AnswerMap = answers) {
    if (!question || submitting) return;
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);

    const validation = validateAnswer(question, currentAnswers[question.id]);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }

    const next = evaluateNextStep(compiled, question.id, currentAnswers);
    if (next.type === "ending") {
      void finish(currentAnswers, next.endingId);
    } else {
      setError(null);
      setHistory((h) => [...h, question.id]);
      setCurrentId(next.questionId);
      onAnswerChange?.(currentAnswers, next.questionId);
    }
  }

  function setAnswer(value: unknown) {
    if (!question) return;
    const next = { ...answers, [question.id]: value };
    setAnswers(next);
    setError(null);
    onAnswerChange?.(next, question.id);

    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    const isTypingOther = typeof value === "string" && value.startsWith(OTHER_PREFIX);
    const willEnd = evaluateNextStep(compiled, question.id, next).type === "ending";
    // Never auto-submit: the last step always waits for an explicit
    // click on Submit, so a stray tap can't end the form early.
    if (AUTO_ADVANCE_TYPES.has(question.type) && !isTypingOther && !willEnd) {
      advanceTimerRef.current = setTimeout(() => goNext(next), AUTO_ADVANCE_DELAY_MS);
    }
  }

  function goBack() {
    if (history.length === 0 || submitting) return;
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setCurrentId(prev);
    setError(null);
    onAnswerChange?.(answers, prev);
  }

  // Latest goNext for the document-level listener below, which is
  // registered once rather than on every render.
  const goNextRef = useRef(goNext);
  useEffect(() => {
    goNextRef.current = goNext;
  });

  useEffect(() => {
    // Listening on the document (not the form container) so Enter
    // still works on questions with no text input — checkboxes, stars,
    // yes/no — where focus otherwise sits on <body> after the previous
    // question's input unmounts.
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter" || e.isComposing) return;
      const target = e.target as HTMLElement | null;
      const container = containerRef.current;
      if (!target || !container) return;
      // Only when focus is ours: inside the runtime, on <body>, or on an
      // ancestor wrapping it (the Preview dialog's content element) —
      // never while some unrelated control elsewhere has focus.
      const ours =
        target === document.body ||
        container.contains(target) ||
        target.contains(container);
      if (!ours) return;
      const tag = target.tagName;
      if (tag === "TEXTAREA" && e.shiftKey) return; // newline
      const role = target.getAttribute("role");
      // Radix radio/checkbox items (they carry data-state) deliberately
      // ignore Enter per WAI-ARIA, so for them Enter means "done, next".
      // Every other button/link activates itself natively — Enter on
      // "Yes" must choose Yes, not skip past it.
      const isRadixChoice =
        (role === "radio" || role === "checkbox") && target.hasAttribute("data-state");
      if ((tag === "BUTTON" && !isRadixChoice) || tag === "A") return;
      e.preventDefault();
      goNextRef.current();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(
    () => () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    },
    [],
  );

  const containerStyle: React.CSSProperties = {
    backgroundColor: theme.backgroundColor,
    color: theme.textColor ?? undefined,
    fontFamily: THEME_FONT_STACK[theme.fontFamily],
    backgroundImage: theme.backgroundImageUrl
      ? `url(${theme.backgroundImageUrl})`
      : undefined,
    backgroundSize: "cover",
    backgroundPosition: "center",
  };

  const buttonStyle: React.CSSProperties = {
    backgroundColor: theme.primaryColor,
    borderRadius: THEME_BUTTON_RADIUS[theme.buttonStyle],
  };

  if (ending) {
    return (
      <div
        className={cn(
          "flex h-full min-h-[420px] flex-col items-center justify-center gap-4 p-10 text-center",
          className,
        )}
        style={containerStyle}
      >
        {theme.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- external, variable-origin Supabase Storage URL
          <img src={theme.logoUrl} alt="" className="h-10 object-contain" />
        )}
        <h2 className="text-2xl font-semibold">{ending.title}</h2>
        {ending.description && (
          <p className="max-w-md opacity-80">{ending.description}</p>
        )}
        {ending.redirectUrl && (
          <Button asChild style={buttonStyle} className="text-white">
            <a href={ending.redirectUrl}>{ending.buttonLabel || "Continue"}</a>
          </Button>
        )}
      </div>
    );
  }

  if (!question) {
    return (
      <div
        className={cn(
          "flex h-full min-h-[420px] items-center justify-center p-10 text-center text-sm opacity-70",
          className,
        )}
      >
        This form has no questions yet.
      </div>
    );
  }

  const entry = isEntryScreen(question);
  const primaryLabel = entry
    ? question.settings.buttonLabel || (isLastStep ? "Submit" : "Start")
    : isLastStep
      ? "Submit"
      : "OK";

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex h-full min-h-[420px] flex-col justify-between gap-6 p-6 sm:p-10",
        className,
      )}
      style={containerStyle}
    >
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-5">
        {theme.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- external, variable-origin Supabase Storage URL
          <img src={theme.logoUrl} alt="" className="h-8 self-start object-contain" />
        )}
        <div>
          <h2 className="text-xl font-semibold sm:text-2xl">
            {question.label}
            {question.required && !entry && (
              <span aria-hidden className="ml-1" style={{ color: theme.primaryColor }}>
                *
              </span>
            )}
            {question.required && !entry && <span className="sr-only"> (required)</span>}
          </h2>
          {question.description && (
            <p className="mt-1.5 text-sm opacity-70 sm:text-base">
              {question.description}
            </p>
          )}
        </div>

        <RuntimeQuestionInput
          key={question.id}
          question={question}
          value={answers[question.id]}
          onChange={setAnswer}
          primaryColor={theme.primaryColor}
          responseId={responseId}
        />

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-1 flex items-center gap-3">
          {history.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Back"
              onClick={goBack}
              disabled={submitting}
            >
              <ArrowLeft />
            </Button>
          )}
          <Button
            type="button"
            onClick={() => goNext()}
            style={buttonStyle}
            className="text-white"
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="animate-spin" /> Submitting…
              </>
            ) : (
              <>
                {primaryLabel}
                {!entry && !isLastStep && <ArrowRight />}
              </>
            )}
          </Button>
          {!submitting && (
            <span className="hidden text-xs opacity-50 sm:inline">
              {question.type === "long_text"
                ? "Shift ⇧ + Enter ↵ for a new line"
                : "press Enter ↵"}
            </span>
          )}
        </div>
      </div>

      {currentIndex >= 0 && (
        <div
          role="progressbar"
          aria-label="Form progress"
          aria-valuenow={currentIndex + 1}
          aria-valuemin={1}
          aria-valuemax={compiled.orderedQuestionIds.length}
          className="mx-auto h-1 w-full max-w-xl overflow-hidden rounded-full bg-black/10"
        >
          <div
            className="h-full transition-all"
            style={{
              width: `${((currentIndex + 1) / compiled.orderedQuestionIds.length) * 100}%`,
              backgroundColor: theme.primaryColor,
            }}
          />
        </div>
      )}
    </div>
  );
}
