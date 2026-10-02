"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CompiledFormV1 } from "@/domains/forms/schema/compile";
import type { EndingV1, QuestionV1 } from "@/domains/forms/schema/v1";
import {
  engineInputs,
  evaluateNextStep,
  firstQuestionId,
  questionLogicError,
  renderRecall,
  renderRecallUrl,
  stateAt,
  validateAnswer,
  walkForm,
  hasAnswer,
  OTHER_PREFIX,
  type AnswerMap,
  type RecallSource,
} from "@/domains/logic";
import { RuntimeQuestionInput } from "./runtime-question-input";
import {
  Stage,
  StageActions,
  StageButton,
  StageError,
  StageNumber,
  WelcomeBackBanner,
  stageDescClass,
  stageLabelClass,
  stageTitleClass,
  type StageMode,
} from "./stage";
import { cn } from "cn";

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

/** A–Z picks a choice tile, Y/N answers yes/no, 0–9 sets a rating or
 * scale value — unless the respondent is typing in a field. */
function pickByKey(e: KeyboardEvent, container: HTMLElement | null) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
  const target = e.target as HTMLElement | null;
  if (!container || !target) return;
  const typing =
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable;
  if (typing) return;
  if (!(
    target === document.body ||
    container.contains(target) ||
    target.contains(container)
  ))
    return;
  const key = e.key.toUpperCase();
  const tile = container.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
  if (!tile) return;
  e.preventDefault();
  tile.click();
  tile.focus({ preventScroll: true });
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
  getResponseId,
  savesProgress = false,
  onStepEvent,
  className,
  mode = "auto",
  welcomeBack = false,
  redirectOnEnding = false,
  hidden,
}: {
  /** Values for the form's hidden fields (from the page URL). */
  hidden?: Record<string, string>;
  /** Sizes: "auto" (the public form) follows the screen; Preview forces
   * desktop or phone. */
  mode?: StageMode;
  /** Resumed from saved progress: show the "Welcome back" pill. */
  welcomeBack?: boolean;
  /** The live form follows an ending's redirect after a 3s countdown;
   * Preview never navigates away. */
  redirectOnEnding?: boolean;
  /** Public runtime only: step analytics (ids only, never values). */
  onStepEvent?: (
    type: "question_viewed" | "question_answered",
    questionId: string,
  ) => void;
  /** The public form saves answers as they're given — tell respondents
   * so (PRD P2.7). Off in Preview, which never saves anything. */
  savesProgress?: boolean;
  compiled: CompiledFormV1;
  initialAnswers?: AnswerMap;
  initialQuestionId?: string;
  initialHistory?: string[];
  /** Only present in the real public runtime — see
   * runtime-question-input.tsx's FileUploadInput for why. */
  getResponseId?: () => Promise<string>;
  onAnswerChange?: (
    answers: AnswerMap,
    currentQuestionId: string,
    history: string[],
  ) => void;
  onComplete?: (answers: AnswerMap) => Promise<CompleteOutcome>;
  /** Layout for the outer container — e.g. `min-h-dvh` on the public
   * page so the theme background covers the whole viewport. */
  className?: string;
}) {
  const engineOptions = useMemo(() => ({ hidden }), [hidden]);
  const [currentId, setCurrentId] = useState(
    initialQuestionId && compiled.orderedQuestionIds.includes(initialQuestionId)
      ? initialQuestionId
      : (firstQuestionId(compiled, initialAnswers ?? {}, { hidden }) ??
          compiled.orderedQuestionIds[0]),
  );
  const [answers, setAnswers] = useState<AnswerMap>(initialAnswers ?? {});
  const [history, setHistory] = useState<string[]>(initialHistory ?? []);
  const [ending, setEnding] = useState<EndingV1 | null>(null);
  // What the ending's recall reads: the final variables for these answers.
  const [endingRecall, setEndingRecall] = useState<RecallSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Which way the last step moved, for the slide direction.
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const questionHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const endingHeadingRef = useRef<HTMLHeadingElement | null>(null);
  // Which step focus was last placed for, so the first screen (and
  // Strict Mode's repeat effect run) never grabs focus on page load.
  const focusedStepRef = useRef(currentId);

  const question = compiled.schema.questions.find((q) => q.id === currentId);
  const currentIndex = compiled.orderedQuestionIds.indexOf(currentId);
  // Where the respondent goes from here, given the questions they have
  // already been shown (so a form with a legacy backward jump can't
  // send them round in circles).
  function stepFrom(questionId: string, from: AnswerMap) {
    return evaluateNextStep(
      compiled,
      questionId,
      from,
      new Set([...history, questionId]),
      engineOptions,
    );
  }

  // Recall ({{score}}, {{answer:…}}) for the question on screen reads the
  // variables as they stand before it's answered.
  const resolvedHidden = useMemo(
    () => engineInputs(compiled, engineOptions).hidden,
    [compiled, engineOptions],
  );
  const recallSource = useMemo<RecallSource>(
    () => ({
      schema: compiled.schema,
      answers,
      variables: stateAt(compiled, answers, [...history, currentId], engineOptions)
        .variables,
      hidden: resolvedHidden,
    }),
    [compiled, answers, history, currentId, engineOptions, resolvedHidden],
  );
  const recall = (text: string | undefined) => renderRecall(text, recallSource);

  function showEnding(finalAnswers: AnswerMap, endingId: string) {
    setEnding(compiled.schema.endings.find((e) => e.id === endingId) ?? null);
    setEndingRecall({
      schema: compiled.schema,
      answers: finalAnswers,
      variables: walkForm(compiled, finalAnswers, engineOptions).variables,
      hidden: resolvedHidden,
    });
  }
  const isLastStep =
    question !== undefined && stepFrom(question.id, answers).type === "ending";

  async function finish(finalAnswers: AnswerMap, endingId: string) {
    if (!onComplete) {
      showEnding(finalAnswers, endingId);
      return;
    }

    setSubmitting(true);
    const outcome = await onComplete(finalAnswers);
    setSubmitting(false);

    if (outcome.ok) {
      const serverEndingId = compiled.schema.endings.some(
        (e) => e.id === outcome.endingId,
      )
        ? outcome.endingId
        : endingId;
      showEnding(finalAnswers, serverEndingId);
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
    // The form's own conditional / cross-field checks.
    const logicError = questionLogicError(
      compiled,
      currentAnswers,
      [...history, question.id],
      engineOptions,
    );
    if (logicError) {
      setError(logicError);
      return;
    }

    if (!isEntryScreen(question) && hasAnswer(question, currentAnswers[question.id])) {
      onStepEvent?.("question_answered", question.id);
    }
    const next = stepFrom(question.id, currentAnswers);
    if (next.type === "ending") {
      void finish(currentAnswers, next.endingId);
    } else {
      setError(null);
      setDirection("forward");
      const nextHistory = [...history, question.id];
      setHistory(nextHistory);
      setCurrentId(next.questionId);
      onAnswerChange?.(currentAnswers, next.questionId, nextHistory);
    }
  }

  function setAnswer(value: unknown) {
    if (!question) return;
    const next = { ...answers, [question.id]: value };
    setAnswers(next);
    setError(null);
    onAnswerChange?.(next, question.id, history);

    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    const isTypingOther = typeof value === "string" && value.startsWith(OTHER_PREFIX);
    const willEnd = stepFrom(question.id, next).type === "ending";
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
    const prevHistory = history.slice(0, -1);
    setDirection("back");
    setHistory(prevHistory);
    setCurrentId(prev);
    setError(null);
    onAnswerChange?.(answers, prev, prevHistory);
  }

  // One question_viewed per step shown (the ref also absorbs Strict
  // Mode's double effect run in development).
  const lastViewedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!onStepEvent || ending || lastViewedRef.current === currentId) return;
    lastViewedRef.current = currentId;
    onStepEvent("question_viewed", currentId);
  }, [currentId, ending, onStepEvent]);

  // When the step changes, keep keyboard and screen-reader users where
  // the form is. A text field takes focus itself (autoFocus); for every
  // other kind of question — choices, ratings, yes/no — the old field
  // just unmounted, which would leave focus on <body>: nothing is read
  // out and Tab starts again from the top of the page. Land on the new
  // question's heading instead (Tab then moves into its options).
  useEffect(() => {
    const step = ending ? `ending:${ending.id}` : currentId;
    if (focusedStepRef.current === step) return;
    focusedStepRef.current = step;
    const heading = ending ? endingHeadingRef.current : questionHeadingRef.current;
    const active = document.activeElement;
    const focusIsLost = !active || active === document.body;
    if (heading && (ending || focusIsLost)) heading.focus({ preventScroll: true });
  }, [currentId, ending]);

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
      if (e.isComposing) return;
      if (e.key !== "Enter") {
        pickByKey(e, containerRef.current);
        return;
      }
      // A field that handles Enter itself (e.g. the contact block moving
      // to its next input) marks the event handled. stopPropagation
      // can't express that here: React's own listeners live on the
      // document too, alongside this one.
      if (e.defaultPrevented) return;
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

  const theme = compiled.schema.theme;
  // Numbers count every step after the welcome screen, as the builder does.
  const numbered = compiled.orderedQuestionIds.filter(
    (id) => compiled.schema.questions.find((q) => q.id === id)?.type !== "welcome_screen",
  );
  const total = numbered.length || 1;

  if (ending) {
    return (
      <EndingScreen
        ending={ending}
        recallSource={endingRecall}
        theme={theme}
        mode={mode}
        className={className}
        headingRef={endingHeadingRef}
        redirect={redirectOnEnding}
      />
    );
  }

  if (!question) {
    return (
      <Stage theme={theme} mode={mode} className={cn("min-h-[420px]", className)}>
        <p className="text-center text-sm text-(--st-muted)">
          This form has no questions yet.
        </p>
      </Stage>
    );
  }

  const entry = isEntryScreen(question);
  const number = numbered.indexOf(question.id) + 1;
  const autoAdvances = AUTO_ADVANCE_TYPES.has(question.type);
  const primaryLabel = entry
    ? recall(question.settings.buttonLabel) ||
      (isLastStep ? "Submit" : question.type === "statement" ? "Continue" : "Start")
    : isLastStep
      ? "Submit"
      : "OK";
  const enterHint =
    question.type === "long_text" ? "Shift ⇧ + Enter ↵ for a new line" : "press Enter ↵";
  const progress = question.type === "welcome_screen" ? 0 : Math.min(1, number / total);
  const welcome = question.type === "welcome_screen";

  return (
    <Stage
      ref={containerRef}
      theme={theme}
      mode={mode}
      progress={progress}
      banner={welcomeBack && history.length === 0 ? <WelcomeBackBanner /> : undefined}
      className={cn("min-h-[420px]", className)}
    >
      {/* Spam trap: invisible to people and skipped by keyboard and screen
          readers; bots that fill every field reveal themselves. The name
          is deliberately meaningless — browsers and password managers
          autofill fields called "website", "url" and the like, which once
          flagged a real person's submission. Autofill hints are switched
          off for the managers that honour them. A filled trap only flags
          the response; it is never discarded. */}
      <input
        type="text"
        name="zq7_hp"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        data-lpignore="true"
        data-1p-ignore="true"
        data-bwignore="true"
        data-form-type="other"
        className="pointer-events-none absolute -left-[9999px] size-px opacity-0"
      />
      <div
        key={question.id}
        className={cn(
          "flex flex-col gap-(--st-gap)",
          direction === "back" ? "fc-step-in-back" : "fc-step-in",
        )}
      >
        {entry ? (
          <div
            className={cn(
              "flex flex-col gap-4",
              welcome &&
                "in-data-[mode=desktop]:items-center in-data-[mode=desktop]:text-center md:in-data-[mode=auto]:items-center md:in-data-[mode=auto]:text-center",
            )}
          >
            {question.settings.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- creator-uploaded Supabase Storage URL
              <img
                src={question.settings.imageUrl}
                alt={question.settings.imageAlt ?? ""}
                className="max-h-64 w-full rounded-(--st-tile-br) object-contain"
              />
            )}
            <h2
              ref={questionHeadingRef}
              tabIndex={-1}
              className={cn(stageTitleClass, "outline-none focus-visible:shadow-none")}
            >
              {recall(question.label)}
            </h2>
            {question.description && (
              <p className={cn(stageDescClass, "max-w-[460px]")}>
                {recall(question.description)}
              </p>
            )}
            {error && <StageError>{error}</StageError>}
            <div className="mt-2 flex items-center gap-3 in-data-[mode=phone]:w-full max-md:in-data-[mode=auto]:w-full">
              <StageButton
                onClick={() => goNext()}
                disabled={submitting}
                className="px-[26px] in-data-[mode=phone]:flex-1 max-md:in-data-[mode=auto]:flex-1"
              >
                {submitting && (
                  <span className="size-[15px] animate-spin rounded-full border-2 border-current border-t-transparent" />
                )}
                {submitting ? "Submitting…" : primaryLabel}
              </StageButton>
              {!submitting && (
                <span className="text-[12.5px] text-(--st-muted) in-data-[mode=phone]:hidden max-md:in-data-[mode=auto]:hidden [@media(hover:none)]:hidden">
                  {enterHint}
                </span>
              )}
            </div>
          </div>
        ) : (
          <>
            {number > 0 && <StageNumber n={number} />}
            <div className="flex flex-col gap-2">
              <h2
                ref={questionHeadingRef}
                tabIndex={-1}
                className={cn(stageLabelClass, "outline-none focus-visible:shadow-none")}
              >
                {recall(question.label)}
                {question.required && question.type !== "contact_info" && (
                  <>
                    <span aria-hidden className="text-(--st-primary)">
                      {" "}
                      *
                    </span>
                    <span className="sr-only"> (required)</span>
                  </>
                )}
              </h2>
              {question.description && (
                <p className={stageDescClass}>{recall(question.description)}</p>
              )}
            </div>

            <RuntimeQuestionInput
              key={question.id}
              question={question}
              value={answers[question.id]}
              onChange={setAnswer}
              getResponseId={getResponseId}
              invalid={!!error}
            />

            {error && <StageError>{error}</StageError>}

            <StageActions
              showBack={history.length > 0}
              onBack={goBack}
              onNext={() => goNext()}
              label={primaryLabel}
              submitting={submitting}
              showCheck={!isLastStep && !autoAdvances}
              enterHint={enterHint}
            />
          </>
        )}

        {savesProgress && currentIndex >= 0 && !entry && (
          <p className="text-xs text-(--st-muted)">
            {question.type === "contact_info"
              ? "Your details are saved when you continue, even if you don't finish."
              : "Your answers are saved as you go."}
          </p>
        )}
      </div>
    </Stage>
  );
}

const REDIRECT_SECONDS = 3;

/** An ending (Part 6 §6.4, Part 8 §3). With a redirect URL on the live
 * form: the response is already saved, so count down 3s, then go in
 * the same tab; if the browser blocks it, the button stays. */
function EndingScreen({
  ending,
  recallSource,
  theme,
  mode,
  className,
  headingRef,
  redirect,
}: {
  ending: EndingV1;
  /** Final answers and variables, for {{score}}-style recall. */
  recallSource: RecallSource | null;
  theme: CompiledFormV1["schema"]["theme"];
  mode: StageMode;
  className?: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  redirect: boolean;
}) {
  const recall = (text: string | undefined) =>
    recallSource ? renderRecall(text, recallSource) : text;
  const target =
    ending.redirectUrl && recallSource
      ? renderRecallUrl(ending.redirectUrl, recallSource)
      : ending.redirectUrl;
  const counting = redirect && !!target;
  const [secondsLeft, setSecondsLeft] = useState(REDIRECT_SECONDS);
  const host = target ? safeHost(target) : null;

  useEffect(() => {
    if (!counting || !target) return;
    if (secondsLeft <= 0) {
      window.location.assign(target);
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [counting, target, secondsLeft]);

  return (
    <Stage
      theme={theme}
      mode={mode}
      progress={1}
      madeWith={ending.showMadeWith !== false}
      className={cn("min-h-[420px]", className)}
    >
      <div className="fc-step-in flex flex-col items-start gap-4 pb-10">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className={cn(stageTitleClass, "outline-none focus-visible:shadow-none")}
        >
          {recall(ending.title)}
        </h2>
        {ending.description && (
          <p className={cn(stageDescClass, "max-w-[460px]")}>
            {recall(ending.description)}
          </p>
        )}
        {counting && secondsLeft > 0 && (
          <p role="status" className="text-[15px] text-(--st-muted)">
            Taking you to <strong className="text-(--st-text)">{host}</strong> in{" "}
            {secondsLeft} second{secondsLeft === 1 ? "" : "s"}…
          </p>
        )}
        {target && (
          <div className="mt-2 flex flex-col items-start gap-2 in-data-[mode=phone]:w-full max-md:in-data-[mode=auto]:w-full">
            <StageButton
              onClick={() => window.location.assign(target)}
              className="px-[26px] in-data-[mode=phone]:w-full max-md:in-data-[mode=auto]:w-full"
            >
              {counting ? "Go now" : recall(ending.buttonLabel) || `Continue to ${host}`}
            </StageButton>
            {counting && (
              <span className="text-[12.5px] text-(--st-muted)">
                Not redirected? Use the button above.
              </span>
            )}
          </div>
        )}
      </div>
    </Stage>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
