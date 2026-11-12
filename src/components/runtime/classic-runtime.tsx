"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { contactFromAnswers, schedulerEmbedUrl } from "@/domains/forms/scheduler";
import { uiStrings } from "@/domains/forms/i18n";
import {
  nextPageWithContent,
  pageOf,
  shownOnPage,
  splitPages,
} from "@/domains/forms/pages";
import type { EndingV1, QuestionV1 } from "@/domains/forms/schema/v1";
import { NON_ANSWERABLE_TYPES } from "@/domains/forms/schema/question-types";
import {
  engineInputs,
  hasAnswer,
  hasRecall,
  questionLogicError,
  renderRecall,
  stateAt,
  validateAnswer,
  walkForm,
  type AnswerMap,
  type RecallSource,
} from "@/domains/logic";
import { cn } from "cn";
import { usePendingSaves } from "./pending-saves";
import { RuntimeStringsContext } from "./runtime-strings";
import { RuntimeQuestionInput } from "./runtime-question-input";
import {
  EndingScreen,
  FinishLater,
  withDisplayOrder,
  type FormRuntimeProps,
} from "./form-runtime";
import {
  NoticeBanner,
  Stage,
  StageButton,
  StageError,
  WelcomeBackBanner,
  stageDescClass,
  stageTitleClass,
} from "./stage";
import type { Value } from "@/domains/forms/schema/logic-model";

const PAGE_TITLE = cn(
  stageTitleClass,
  "fc-page-title outline-none focus-visible:shadow-none",
);
const QUESTION_LABEL =
  "fc-question-label text-[1.2rem] leading-snug font-semibold tracking-[-0.01em] text-pretty";

/**
 * The classic layout (master spec F-01): pages of several questions,
 * split by page breaks, with Next / Back between them and Submit on the
 * last. It runs on the same engine as the one-question-at-a-time layout:
 * a page shows its questions that are on the path for the answers so far
 * (walkForm), so show conditions, jumps, scores, random and adaptive
 * groups, carried-forward options and validation behave the same — a jump
 * to a later question just leaves out what's in between, on this page or
 * the next. Like FormRuntime, it never calls the network itself.
 *
 * Not here: AI follow-ups (a conversation one question at a time; the
 * builder warns) and Enter-to-continue (several fields share the screen,
 * so Enter moves within a field and the Next button moves on).
 */
export function ClassicFormRuntime({
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
  onFinishLater,
  notice,
  seed,
  brandingRemovable = true,
  schedulingAllowed = true,
  language,
  known,
  lookups,
}: FormRuntimeProps) {
  const engineOptions = useMemo(() => ({ hidden, seed }), [hidden, seed]);
  const t = useMemo(() => uiStrings(language), [language]);
  const pages = useMemo(() => splitPages(compiled), [compiled]);
  const byId = useMemo(
    () => new Map(compiled.schema.questions.map((q) => [q.id, q])),
    [compiled],
  );

  // Answers this visitor gave on another form ("ask once") are filled in
  // here — shown and editable — rather than skipped as one at a time.
  const [answers, setAnswers] = useState<AnswerMap>(() => {
    const filled: AnswerMap = {};
    for (const [id, value] of Object.entries(known ?? {})) {
      const question = byId.get(id);
      if (question && validateAnswer(question, value).ok) filled[id] = value;
    }
    return { ...filled, ...(initialAnswers ?? {}) };
  });
  const walk = useMemo(
    () => walkForm(compiled, answers, engineOptions),
    [compiled, answers, engineOptions],
  );
  const onPath = useMemo(() => new Set(walk.visitedQuestionIds), [walk]);

  // Resumed: back on the page they were on, with the pages before it to
  // go back to. Fresh: the first page with something to show.
  const [opening] = useState(() => {
    const resumedAt = initialQuestionId ? pageOf(pages, initialQuestionId) : -1;
    const first = nextPageWithContent(pages, onPath, 0);
    const stack = [
      ...new Set((initialHistory ?? []).map((id) => pageOf(pages, id))),
    ].filter((i) => i >= 0 && i < resumedAt);
    return resumedAt >= 0
      ? { page: resumedAt, stack }
      : { page: first === -1 ? 0 : first, stack: [] as number[] };
  });
  const [pageIndex, setPageIndex] = useState(opening.page);
  const [pageStack, setPageStack] = useState<number[]>(opening.stack);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [thinking, setThinking] = useState(false);
  // Next pressed while a signature was still saving: go on once saved.
  const pendingSaves = usePendingSaves();
  const advanceWhenSavedRef = useRef(false);
  const [ending, setEnding] = useState<EndingV1 | null>(null);
  const [endingRecall, setEndingRecall] = useState<RecallSource | null>(null);
  const [completedResponseId, setCompletedResponseId] = useState<string | undefined>();
  const ranLookupsRef = useRef(new Set<string>());
  const [resumeAfterLookup, setResumeAfterLookup] = useState(0);
  const pageHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const endingHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const page = pages[pageIndex];
  const shown = page ? shownOnPage(page, onPath) : [];
  const nextIndex = nextPageWithContent(pages, onPath, pageIndex + 1);
  const isLastPage = nextIndex === -1;
  const contentPages = pages.filter((p) => shownOnPage(p, onPath).length > 0);
  const position = page ? Math.max(0, contentPages.indexOf(page)) : 0;

  const resolvedHidden = useMemo(
    () => engineInputs(compiled, engineOptions).hidden,
    [compiled, engineOptions],
  );
  /** Recall for an item reads the variables as they stand before it. */
  function recall(text: string | undefined, questionId: string) {
    if (!text || !hasRecall(text)) return text;
    const path = walk.visitedQuestionIds.slice(
      0,
      walk.visitedQuestionIds.indexOf(questionId) + 1,
    );
    return renderRecall(text, {
      schema: compiled.schema,
      answers,
      variables: stateAt(compiled, answers, path, engineOptions).variables,
      hidden: resolvedHidden,
    });
  }

  /** The first question of each page before `index` that was on the path:
   * what's saved as this respondent's history, so a refresh comes back to
   * the same page with the same pages behind it. */
  function historyFor(stack: number[]): string[] {
    return stack.map((i) => shownOnPage(pages[i], onPath)[0] ?? pages[i].ids[0]);
  }

  function setAnswer(questionId: string, value: unknown) {
    const next = { ...answers, [questionId]: value };
    setAnswers(next);
    if (errors[questionId]) {
      setErrors(({ [questionId]: _done, ...rest }) => {
        void _done;
        return rest;
      });
    }
    setFormError(null);
    onAnswerChange?.(next, questionId, historyFor(pageStack));
  }

  /** Every check a question on this page has: its own answer rules, then
   * the form's conditional / cross-field checks. */
  function pageErrors(): Record<string, string> {
    const found: Record<string, string> = {};
    for (const id of shown) {
      const question = byId.get(id);
      if (!question || NON_ANSWERABLE_TYPES.has(question.type)) continue;
      const check = validateAnswer(question, answers[id]);
      if (!check.ok) {
        found[id] = check.message;
        continue;
      }
      const path = walk.visitedQuestionIds.slice(
        0,
        walk.visitedQuestionIds.indexOf(id) + 1,
      );
      const logic = questionLogicError(compiled, answers, path, engineOptions);
      if (logic) found[id] = logic;
    }
    return found;
  }

  function focusQuestion(id: string) {
    const heading = document.getElementById(`fc-q-${id}`);
    heading?.focus({ preventScroll: false });
  }

  async function finish(finalAnswers: AnswerMap, endingId: string) {
    const show = (id: string, serverVariables?: Record<string, Value>) => {
      setEnding(compiled.schema.endings.find((e) => e.id === id) ?? null);
      setEndingRecall({
        schema: compiled.schema,
        answers: finalAnswers,
        // The server's final scores win: the browser may not have the
        // option points to work them out (QA FC4-02).
        variables: {
          ...walkForm(compiled, finalAnswers, engineOptions).variables,
          ...serverVariables,
        },
        hidden: resolvedHidden,
      });
    };
    if (!onComplete) return show(endingId);
    setSubmitting(true);
    const outcome = await onComplete(finalAnswers);
    if (outcome.ok && outcome.redirecting) return;
    setSubmitting(false);
    if (outcome.ok) {
      setCompletedResponseId(outcome.responseId);
      show(
        compiled.schema.endings.some((e) => e.id === outcome.endingId)
          ? outcome.endingId
          : endingId,
        outcome.variables,
      );
      return;
    }
    // The server's answer is final: take the respondent to the page of the
    // first question it rejected, with each message under its question.
    const rejected = outcome.errors ?? [];
    if (rejected.length > 0) {
      const target = pageOf(pages, rejected[0].questionId);
      setErrors(Object.fromEntries(rejected.map((e) => [e.questionId, e.message])));
      if (target >= 0 && target !== pageIndex) {
        setPageStack((stack) => stack.filter((i) => i < target));
        setPageIndex(target);
      } else {
        focusQuestion(rejected[0].questionId);
      }
      return;
    }
    setFormError(outcome.message);
  }

  function goNext() {
    if (submitting || thinking) return;
    if (pendingSaves > 0) {
      advanceWhenSavedRef.current = true;
      return;
    }
    const found = pageErrors();
    setErrors(found);
    const firstInvalid = shown.find((id) => found[id]);
    if (firstInvalid) {
      focusQuestion(firstInvalid);
      return;
    }

    // External data for this page's trigger questions, before deciding
    // where to go (rules may read it).
    const pending = shown.filter((id) => {
      const key = `${id}:${JSON.stringify(answers[id] ?? null)}`;
      return lookups?.triggers.has(id) && !ranLookupsRef.current.has(key);
    });
    if (lookups && pending.length > 0) {
      setThinking(true);
      void (async () => {
        for (const id of pending) {
          ranLookupsRef.current.add(`${id}:${JSON.stringify(answers[id] ?? null)}`);
          await lookups.run(id, answers).catch(() => null);
        }
        setThinking(false);
        setResumeAfterLookup((n) => n + 1);
      })();
      return;
    }

    for (const id of shown) {
      const question = byId.get(id);
      if (
        question &&
        !NON_ANSWERABLE_TYPES.has(question.type) &&
        hasAnswer(question, answers[id])
      ) {
        onStepEvent?.("question_answered", id);
      }
    }
    if (isLastPage) {
      void finish(answers, walk.endingId);
      return;
    }
    const stack = [...pageStack, pageIndex];
    setPageStack(stack);
    setPageIndex(nextIndex);
    onAnswerChange?.(
      answers,
      shownOnPage(pages[nextIndex], onPath)[0] ?? pages[nextIndex].ids[0],
      historyFor(stack),
    );
  }

  function goBack() {
    if (pageStack.length === 0 || submitting || thinking) return;
    const prev = pageStack[pageStack.length - 1];
    const stack = pageStack.slice(0, -1);
    setPageStack(stack);
    setPageIndex(prev);
    setErrors({});
    setFormError(null);
    onAnswerChange?.(
      answers,
      shownOnPage(pages[prev], onPath)[0] ?? pages[prev].ids[0],
      historyFor(stack),
    );
  }

  // Latest goNext for the effect that resumes after a lookup returns.
  const goNextRef = useRef(goNext);
  useEffect(() => {
    goNextRef.current = goNext;
  });
  useEffect(() => {
    if (resumeAfterLookup > 0) goNextRef.current();
  }, [resumeAfterLookup]);
  useEffect(() => {
    if (pendingSaves > 0 || !advanceWhenSavedRef.current) return;
    advanceWhenSavedRef.current = false;
    goNextRef.current();
  }, [pendingSaves]);

  // A new page: back to its top, the page heading focused for screen
  // readers, and its questions counted as viewed (ids only).
  const viewedRef = useRef(new Set<string>());
  const firstPageRef = useRef(true);
  useEffect(() => {
    if (ending) return;
    for (const id of shown) {
      if (viewedRef.current.has(id)) continue;
      viewedRef.current.add(id);
      const question = byId.get(id);
      if (question && !NON_ANSWERABLE_TYPES.has(question.type)) {
        onStepEvent?.("question_viewed", id);
      }
    }
  });
  useEffect(() => {
    if (firstPageRef.current) {
      firstPageRef.current = false;
      return;
    }
    stageRef.current?.scrollIntoView?.({ block: "start" });
    pageHeadingRef.current?.focus({ preventScroll: true });
  }, [pageIndex]);
  useEffect(() => {
    if (ending) endingHeadingRef.current?.focus({ preventScroll: true });
  }, [ending]);

  const theme = compiled.schema.theme;

  if (ending) {
    return (
      <EndingScreen
        ending={ending}
        brandingRemovable={brandingRemovable}
        scheduler={
          schedulingAllowed && ending.scheduler && endingRecall
            ? schedulerEmbedUrl(ending.scheduler, {
                ...contactFromAnswers(compiled.schema, endingRecall.answers),
                responseId: completedResponseId,
              })
            : null
        }
        meta={compiled.schema.meta}
        recallSource={endingRecall}
        theme={theme}
        mode={mode}
        className={className}
        headingRef={endingHeadingRef}
        redirect={redirectOnEnding}
      />
    );
  }

  if (!page) {
    return (
      <Stage theme={theme} mode={mode} className={cn("min-h-[420px]", className)}>
        <p className="text-center text-sm text-(--st-muted)">
          This form has no questions yet.
        </p>
      </Stage>
    );
  }

  const welcome = shown
    .map((id) => byId.get(id))
    .find((q) => q?.type === "welcome_screen");
  const heading =
    page.title ?? (position === 0 && !welcome ? compiled.schema.meta.title : null);
  const anyAnswered = Object.keys(answers).length > 0;

  return (
    <RuntimeStringsContext.Provider value={t}>
      <Stage
        ref={stageRef}
        theme={theme}
        mode={mode}
        progress={
          contentPages.length > 1 && compiled.schema.theme.showProgress !== false
            ? position / contentPages.length
            : undefined
        }
        banner={
          notice && pageStack.length === 0 ? (
            <NoticeBanner>{notice}</NoticeBanner>
          ) : welcomeBack && pageStack.length === 0 ? (
            <WelcomeBackBanner text={t.welcomeBack} />
          ) : undefined
        }
        className={cn("fc-classic min-h-[420px]", className)}
        contentClassName="gap-8 py-6"
      >
        {/* Spam trap: see FormRuntime. */}
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
        {heading && (
          <header className="flex flex-col gap-2">
            <h1 ref={pageHeadingRef} tabIndex={-1} className={PAGE_TITLE}>
              {heading}
            </h1>
            {page.description && <p className={stageDescClass}>{page.description}</p>}
          </header>
        )}
        {shown.map((id, i) => {
          const question = byId.get(id);
          if (!question) return null;
          return (
            <ClassicItem
              key={id}
              question={question}
              headingRef={!heading && i === 0 ? pageHeadingRef : undefined}
              label={recall(question.label, id) ?? ""}
              description={recall(question.description, id)}
              input={
                <RuntimeQuestionInput
                  question={withDisplayOrder(question, seed, answers)}
                  value={answers[id]}
                  onChange={(value) => setAnswer(id, value)}
                  getResponseId={getResponseId}
                  invalid={!!errors[id]}
                  autoFocus={false}
                  idPrefix={`fc-${id}`}
                />
              }
              error={errors[id]}
            />
          );
        })}

        {formError && <StageError>{formError}</StageError>}
        <div className="flex flex-wrap items-center gap-3">
          {pageStack.length > 0 && (
            <button
              type="button"
              onClick={goBack}
              disabled={submitting || thinking}
              className="fc-back h-(--st-btn-h) rounded-(--st-br) border-[1.5px] border-(--st-line) px-5 font-semibold disabled:opacity-50"
            >
              {t.back}
            </button>
          )}
          <StageButton
            onClick={goNext}
            disabled={submitting || thinking}
            aria-busy={submitting || thinking || undefined}
            className="px-[26px] in-data-[mode=phone]:flex-1 max-md:in-data-[mode=auto]:flex-1"
          >
            {(submitting || thinking) && (
              <span className="size-[15px] animate-spin rounded-full border-2 border-current border-t-transparent" />
            )}
            {submitting
              ? "Submitting…"
              : thinking
                ? t.thinking
                : isLastPage
                  ? t.submit
                  : t.next}
          </StageButton>
          {contentPages.length > 1 && (
            <span className="text-[13px] text-(--st-muted)">
              Page {position + 1} of {contentPages.length}
            </span>
          )}
        </div>
        {savesProgress && <p className="text-xs text-(--st-muted)">{t.savedAsYouGo}</p>}
        {onFinishLater && anyAnswered && (
          <FinishLater key={pageIndex} create={onFinishLater} label={t.finishLater} />
        )}
      </Stage>
    </RuntimeStringsContext.Provider>
  );
}

function ClassicItem({
  question,
  label,
  description,
  input,
  error,
  headingRef,
}: {
  question: QuestionV1;
  label: string;
  description?: string;
  input: React.ReactNode;
  error?: string;
  headingRef?: React.RefObject<HTMLHeadingElement | null>;
}) {
  const screen = question.type === "welcome_screen" || question.type === "statement";
  const image =
    screen && question.settings.imageUrl ? (
      // eslint-disable-next-line @next/next/no-img-element -- creator-uploaded Supabase Storage URL
      <img
        src={question.settings.imageUrl}
        alt={question.settings.imageAlt ?? ""}
        className="max-h-64 w-full rounded-(--st-tile-br) object-contain"
      />
    ) : null;

  if (question.type === "welcome_screen") {
    return (
      <header className="fc-welcome flex flex-col gap-3">
        {image}
        <h1
          id={`fc-q-${question.id}`}
          ref={headingRef}
          tabIndex={-1}
          className={PAGE_TITLE}
        >
          {label}
        </h1>
        {description && <p className={stageDescClass}>{description}</p>}
      </header>
    );
  }
  return (
    <section
      aria-labelledby={`fc-q-${question.id}`}
      className={cn("fc-question flex flex-col gap-3", screen && "fc-statement")}
    >
      {image}
      <h2
        id={`fc-q-${question.id}`}
        ref={headingRef}
        tabIndex={-1}
        className={cn(QUESTION_LABEL, "outline-none focus-visible:shadow-none")}
      >
        {label}
        {question.required && !screen && question.type !== "contact_info" && (
          <>
            <span aria-hidden className="text-(--st-primary)">
              {" "}
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </h2>
      {description && (
        <p className={cn(stageDescClass, "fc-question-description -mt-1")}>
          {description}
        </p>
      )}
      {input}
      {error && <StageError>{error}</StageError>}
    </section>
  );
}
