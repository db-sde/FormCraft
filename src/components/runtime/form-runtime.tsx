"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { CompiledFormV1 } from "@/domains/forms/schema/compile";
import type { EndingV1 } from "@/domains/forms/schema/v1";
import { evaluateNextStep, isAnswered, type AnswerMap } from "@/domains/logic";
import { RuntimeQuestionInput } from "./runtime-question-input";
import { Button } from "@/components/ui/button";
import { THEME_FONT_STACK, THEME_BUTTON_RADIUS } from "@/components/theme-styles";

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
 * This component itself never makes a network call — it just reports
 * state changes through the two callback props and accepts initial
 * state back in (for resuming a partial response after a refresh).
 * Both are optional so the Preview dialog's fire-and-forget usage
 * doesn't need to change.
 */
export function FormRuntime({
  compiled,
  initialAnswers,
  initialQuestionId,
  initialHistory,
  onAnswerChange,
  onComplete,
}: {
  compiled: CompiledFormV1;
  initialAnswers?: AnswerMap;
  initialQuestionId?: string;
  initialHistory?: string[];
  onAnswerChange?: (answers: AnswerMap, currentQuestionId: string) => void;
  onComplete?: (endingId: string, answers: AnswerMap) => void;
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

  const theme = compiled.schema.theme;
  const question = compiled.schema.questions.find((q) => q.id === currentId);
  const currentIndex = compiled.orderedQuestionIds.indexOf(currentId);

  function setAnswer(value: unknown) {
    if (!question) return;
    const next = { ...answers, [question.id]: value };
    setAnswers(next);
    setError(null);
    onAnswerChange?.(next, question.id);
  }

  function goNext() {
    if (!question) return;
    const isEntryScreen =
      question.type === "welcome_screen" || question.type === "statement";
    if (!isEntryScreen && question.required && !isAnswered(answers[question.id])) {
      setError("This question requires an answer.");
      return;
    }

    const next = evaluateNextStep(compiled, question.id, answers);
    if (next.type === "ending") {
      const endingObj = compiled.schema.endings.find((e) => e.id === next.endingId);
      if (endingObj) {
        setEnding(endingObj);
        onComplete?.(next.endingId, answers);
      }
    } else {
      setHistory((h) => [...h, question.id]);
      setCurrentId(next.questionId);
      onAnswerChange?.(answers, next.questionId);
    }
  }

  function goBack() {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setCurrentId(prev);
    setError(null);
    onAnswerChange?.(answers, prev);
  }

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
        className="flex h-full min-h-[420px] flex-col items-center justify-center gap-4 p-10 text-center"
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
      <div className="flex h-full min-h-[420px] items-center justify-center p-10 text-center text-sm opacity-70">
        This form has no questions yet.
      </div>
    );
  }

  const isEntryScreen =
    question.type === "welcome_screen" || question.type === "statement";

  function handleKeyDown(e: React.KeyboardEvent) {
    const target = e.target as HTMLElement;
    // Enter progresses the form, except inside a textarea (where it
    // should insert a newline) or while a dropdown/select is open.
    if (e.key === "Enter" && target.tagName !== "TEXTAREA") {
      e.preventDefault();
      goNext();
    }
  }

  return (
    <div
      className="flex h-full min-h-[420px] flex-col justify-between gap-6 p-10"
      style={containerStyle}
      onKeyDown={handleKeyDown}
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4">
        {theme.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- external, variable-origin Supabase Storage URL
          <img src={theme.logoUrl} alt="" className="h-8 object-contain" />
        )}
        <div>
          <h2 className="text-xl font-semibold">{question.label}</h2>
          {question.description && (
            <p className="mt-1 text-sm opacity-70">{question.description}</p>
          )}
        </div>

        <RuntimeQuestionInput
          question={question}
          value={answers[question.id]}
          onChange={setAnswer}
          primaryColor={theme.primaryColor}
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="mt-2 flex items-center gap-3">
          {history.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Back"
              onClick={goBack}
            >
              <ArrowLeft />
            </Button>
          )}
          <Button
            type="button"
            onClick={goNext}
            style={buttonStyle}
            className="text-white"
          >
            {isEntryScreen ? question.settings.buttonLabel || "Start" : "OK"}
            {!isEntryScreen && <ArrowRight />}
          </Button>
          {!isEntryScreen && <span className="text-xs opacity-50">press Enter ↵</span>}
        </div>
      </div>

      {currentIndex >= 0 && (
        <div className="mx-auto h-1 w-full max-w-md overflow-hidden rounded-full bg-black/10">
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
