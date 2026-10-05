"use client";

import { seededShuffle } from "@/domains/logic/random";
import { availableOptionIds } from "@/domains/forms/options";
import { endingRedirect } from "@/domains/forms/redirect";
import { showsMadeWith } from "@/domains/forms/branding";
import { uiStrings } from "@/domains/forms/i18n";
import { RuntimeStringsContext } from "./runtime-strings";
import { contactFromAnswers, schedulerEmbedUrl } from "@/domains/forms/scheduler";
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
  validateContactField,
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
  NoticeBanner,
  stageDescClass,
  stageLabelClass,
  stageTitleClass,
  type StageMode,
} from "./stage";
import { cn } from "cn";

export type CompleteOutcome =
  | { ok: true; endingId: string; responseId?: string; redirecting?: boolean }
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

/**
 * Progressive profiling: starting at `id`, fills in answers this visitor
 * already gave ("ask once" questions) and steps past them — as long as
 * the remembered answer is still valid and another question follows, so
 * the last step always waits for an explicit click. Each filled question
 * joins the path, exactly as if it had been answered by hand.
 */
function passKnown(
  compiled: CompiledFormV1,
  known: Record<string, unknown> | undefined,
  options: { hidden?: Record<string, string>; seed?: string },
  id: string,
  answers: AnswerMap,
  history: string[],
): { id: string; answers: AnswerMap; history: string[]; filled: string[] } {
  const filled: string[] = [];
  if (!known) return { id, answers, history, filled };
  for (let guard = 0; guard < compiled.orderedQuestionIds.length; guard += 1) {
    const question = compiled.schema.questions.find((q) => q.id === id);
    if (!question || !(id in known)) break;
    const candidate = { ...answers, [id]: known[id] };
    const path = [...history, id];
    if (!validateAnswer(question, known[id]).ok) break;
    if (questionLogicError(compiled, candidate, path, options)) break;
    const next = evaluateNextStep(compiled, id, candidate, new Set(path), options);
    if (next.type !== "question") break;
    filled.push(id);
    answers = candidate;
    history = path;
    id = next.questionId;
  }
  return { id, answers, history, filled };
}

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
  onFinishLater,
  notice,
  seed,
  brandingRemovable = true,
  schedulingAllowed = true,
  language,
  followUps,
  known,
  lookups,
}: {
  /** Public runtime only: external data (phase 24). Leaving one of the
   * `triggers` runs the form's lookups on the server; the values come
   * back through `hidden`. */
  lookups?: {
    triggers: ReadonlySet<string>;
    run: (questionId: string, answers: AnswerMap) => Promise<unknown>;
  };
  /** Public runtime only: answers this visitor already gave to "ask
   * once" questions (progressive profiling), by question id. */
  known?: Record<string, unknown>;
  /** Public runtime only: AI follow-up questions (P3.7). `ask` returns a
   * question about an answer (or null), `reply` saves what they say. */
  followUps?: {
    ask: (questionId: string, answer: string) => Promise<string | null>;
    reply: (questionId: string, text: string) => Promise<void>;
  };
  /** The respondent's language, for FormCraft's own words (P2.21); the
   * form's text arrives already translated in `compiled`. */
  language?: string;
  /** The plan includes booking pages on endings (P2.16). */
  schedulingAllowed?: boolean;
  /** The plan allows switching off the "Made with FormCraft" badge
   * (decided by the server for the live form). */
  brandingRemovable?: boolean;
  /** The response's random seed: which pool questions are asked and the
   * order of shuffled options. */
  seed?: string;
  /** Public runtime, when the creator allows it: a link to finish later
   * (PRD P2.8). */
  onFinishLater?: () => Promise<
    { ok: true; url: string } | { ok: false; message: string }
  >;
  /** A note shown above the first question (e.g. a resume link that
   * no longer works). */
  notice?: string;
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
  const engineOptions = useMemo(() => ({ hidden, seed }), [hidden, seed]);
  const t = useMemo(() => uiStrings(language), [language]);
  // Where the form opens. A fresh visit starts at the first question —
  // past any the visitor has answered before; a resumed one where it was.
  const [opening] = useState(() => {
    const resumedAt =
      initialQuestionId && compiled.orderedQuestionIds.includes(initialQuestionId)
        ? initialQuestionId
        : null;
    const start = {
      id:
        resumedAt ??
        firstQuestionId(compiled, initialAnswers ?? {}, { hidden, seed }) ??
        compiled.orderedQuestionIds[0],
      answers: initialAnswers ?? {},
      history: initialHistory ?? [],
      filled: [] as string[],
    };
    return resumedAt
      ? start
      : passKnown(
          compiled,
          known,
          { hidden, seed },
          start.id,
          start.answers,
          start.history,
        );
  });
  const [currentId, setCurrentId] = useState(opening.id);
  // Lead capture asks one detail per screen: which one is showing.
  const [contactStep, setContactStep] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>(opening.answers);
  const [history, setHistory] = useState<string[]>(opening.history);
  // "Ask once" questions filled in from what the visitor said before.
  const [autoFilled, setAutoFilled] = useState<ReadonlySet<string>>(
    () => new Set(opening.filled),
  );
  // Set by "Answer again": from then on every question is asked.
  const [askEverything, setAskEverything] = useState(false);
  const [ending, setEnding] = useState<EndingV1 | null>(null);
  const [completedResponseId, setCompletedResponseId] = useState<string | undefined>();
  // What the ending's recall reads: the final variables for these answers.
  const [endingRecall, setEndingRecall] = useState<RecallSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // An AI follow-up on the current question: asked at most once each.
  const [followUp, setFollowUp] = useState<{
    questionId: string;
    prompt: string;
    reply: string;
  } | null>(null);
  const [thinking, setThinking] = useState(false);
  // The guard reads the ref: the continuation runs before React has
  // re-rendered with `thinking` back to false.
  const thinkingRef = useRef(false);
  const askedFollowUpsRef = useRef(new Set<string>());
  // Lookups already run, by question and answer (a changed answer looks
  // up again), and a counter that resumes the step once one returns.
  const ranLookupsRef = useRef(new Set<string>());
  const [resumeAfterLookup, setResumeAfterLookup] = useState(0);
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
  const contactFields =
    question?.type === "contact_info" ? question.settings.fields : null;
  const onLastContactField = !contactFields || contactStep >= contactFields.length - 1;
  /** Arriving on a question: its first detail going forward, its last
   * going back. */
  function landOn(id: string, way: "forward" | "back") {
    const q = compiled.schema.questions.find((x) => x.id === id);
    const count = q?.type === "contact_info" ? q.settings.fields.length : 1;
    setContactStep(way === "back" ? count - 1 : 0);
  }
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
    question !== undefined &&
    onLastContactField &&
    stepFrom(question.id, answers).type === "ending";

  async function finish(finalAnswers: AnswerMap, endingId: string) {
    if (!onComplete) {
      showEnding(finalAnswers, endingId);
      return;
    }

    setSubmitting(true);
    const outcome = await onComplete(finalAnswers);
    // Leaving for the payment page: stay "submitting" until we're gone.
    if (outcome.ok && outcome.redirecting) return;
    setSubmitting(false);

    if (outcome.ok) {
      setCompletedResponseId(outcome.responseId);
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
      landOn(firstError.questionId, "forward");
      setError(firstError.message);
      return;
    }
    setError(firstError?.message ?? outcome.message);
  }

  function goNext(currentAnswers: AnswerMap = answers) {
    if (!question || submitting || thinkingRef.current) return;
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);

    // Lead capture: each detail gets its own screen, checked as they go;
    // the whole block is checked again once the last one is done.
    if (question.type === "contact_info" && !onLastContactField) {
      const check = validateContactField(
        question,
        question.settings.fields[contactStep],
        currentAnswers[question.id],
      );
      if (!check.ok) {
        setError(check.message);
        return;
      }
      setError(null);
      setDirection("forward");
      setContactStep(contactStep + 1);
      return;
    }

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

    // External data: fetch it before deciding where to go, since rules
    // may read it. Slow or failed lookups never hold the form up for
    // long — the server gives up after a few seconds.
    const lookupKey = `${question.id}:${JSON.stringify(currentAnswers[question.id] ?? null)}`;
    if (lookups?.triggers.has(question.id) && !ranLookupsRef.current.has(lookupKey)) {
      ranLookupsRef.current.add(lookupKey);
      setError(null);
      thinkingRef.current = true;
      setThinking(true);
      void lookups
        .run(question.id, currentAnswers)
        .catch(() => null)
        .then(() => {
          thinkingRef.current = false;
          setThinking(false);
          // Continue in an effect, after the new values have rendered.
          setResumeAfterLookup((n) => n + 1);
        });
      return;
    }

    // A follow-up that's showing: save the reply (if any) and move on.
    if (followUp?.questionId === question.id) {
      const reply = followUp.reply.trim();
      if (reply) void followUps?.reply(question.id, reply).catch(() => {});
      setFollowUp(null);
    } else if (
      followUps &&
      question.type === "long_text" &&
      question.settings.aiFollowUp &&
      !askedFollowUpsRef.current.has(question.id) &&
      typeof currentAnswers[question.id] === "string" &&
      (currentAnswers[question.id] as string).trim().length >= 3
    ) {
      // Ask once; whatever happens, the respondent is never held up.
      askedFollowUpsRef.current.add(question.id);
      const questionId = question.id;
      setError(null);
      thinkingRef.current = true;
      setThinking(true);
      void followUps
        .ask(questionId, currentAnswers[questionId] as string)
        .catch(() => null)
        .then((prompt) => {
          thinkingRef.current = false;
          setThinking(false);
          if (prompt) setFollowUp({ questionId, prompt, reply: "" });
          else goNextRef.current();
        });
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
      const moved = passKnown(
        compiled,
        askEverything ? undefined : known,
        engineOptions,
        next.questionId,
        currentAnswers,
        [...history, question.id],
      );
      if (moved.filled.length > 0) {
        setAnswers(moved.answers);
        setAutoFilled((prev) => new Set([...prev, ...moved.filled]));
      }
      setHistory(moved.history);
      setCurrentId(moved.id);
      landOn(moved.id, "forward");
      onAnswerChange?.(moved.answers, moved.id, moved.history);
    }
  }

  /** "Answer again": forget the filled-in answers and ask from the first
   * of those questions (someone else may be using this browser). */
  function answerKnownAgain() {
    const first = history.findIndex((id) => autoFilled.has(id));
    if (first < 0 || submitting || thinkingRef.current) return;
    const cleared = Object.fromEntries(
      Object.entries(answers).filter(([id]) => !autoFilled.has(id)),
    );
    const backTo = history[first];
    const earlier = history.slice(0, first);
    setAskEverything(true);
    setAutoFilled(new Set());
    setFollowUp(null);
    setAnswers(cleared);
    setHistory(earlier);
    setCurrentId(backTo);
    landOn(backTo, "forward");
    setError(null);
    setDirection("back");
    onAnswerChange?.(cleared, backTo, earlier);
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
    if (contactStep > 0 && !submitting) {
      setContactStep(contactStep - 1);
      setDirection("back");
      setError(null);
      return;
    }
    if (history.length === 0 || submitting || thinkingRef.current) return;
    setFollowUp(null);
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    // Back to the last question they answered themselves; ones that were
    // filled in for them are stepped over (and never shown).
    let back = history.length - 1;
    while (back >= 0 && autoFilled.has(history[back])) back -= 1;
    if (back < 0) return;
    const prev = history[back];
    const prevHistory = history.slice(0, back);
    setDirection("back");
    setHistory(prevHistory);
    setCurrentId(prev);
    landOn(prev, "back");
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
  // Declared after the effect above, so it runs with the newest goNext —
  // the one that sees the values a lookup just returned.
  useEffect(() => {
    if (resumeAfterLookup > 0) goNextRef.current();
  }, [resumeAfterLookup]);

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
      (isLastStep ? t.submit : question.type === "statement" ? t.continue : t.start)
    : isLastStep
      ? t.submit
      : t.ok;
  const enterHint = question.type === "long_text" ? t.newLine : t.pressEnter;
  // Lead capture fills the bar a detail at a time.
  const contactShare = contactFields ? (contactStep + 1) / contactFields.length : 1;
  const progress =
    question.type === "welcome_screen"
      ? 0
      : Math.min(1, (number - 1 + contactShare) / total);
  const welcome = question.type === "welcome_screen";

  return (
    <RuntimeStringsContext.Provider value={t}>
      <Stage
        ref={containerRef}
        theme={theme}
        mode={mode}
        progress={progress}
        banner={
          notice && history.length === 0 ? (
            <NoticeBanner>{notice}</NoticeBanner>
          ) : welcomeBack && history.length === 0 ? (
            <WelcomeBackBanner text={t.welcomeBack} />
          ) : undefined
        }
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
          key={contactFields ? `${question.id}:${contactStep}` : question.id}
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
                  className={cn(
                    stageLabelClass,
                    "outline-none focus-visible:shadow-none",
                  )}
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
                contactField={
                  contactFields && contactFields.length > 1
                    ? contactFields[contactStep]
                    : undefined
                }
                question={withDisplayOrder(question, seed, answers)}
                value={answers[question.id]}
                onChange={setAnswer}
                getResponseId={getResponseId}
                invalid={!!error}
              />

              {followUp?.questionId === question.id && (
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="fc-follow-up"
                    className="text-(length:--st-tile) font-semibold text-(--st-text)"
                  >
                    <span className="block text-xs font-normal text-(--st-muted)">
                      {t.followUp}
                    </span>
                    {followUp.prompt}
                  </label>
                  <textarea
                    id="fc-follow-up"
                    autoFocus
                    rows={2}
                    maxLength={5000}
                    value={followUp.reply}
                    onChange={(e) =>
                      setFollowUp((f) => (f ? { ...f, reply: e.target.value } : f))
                    }
                    className="field-sizing-content w-full min-w-0 resize-none rounded-none border-0 border-b-2 border-(--st-line) bg-transparent py-2 text-(length:--st-input) leading-[1.45] text-(--st-text) outline-none focus:border-(--st-primary) focus-visible:shadow-none"
                  />
                  <p className="text-xs text-(--st-muted)">{t.followUpHint}</p>
                </div>
              )}

              {error && <StageError>{error}</StageError>}

              <StageActions
                backLabel={t.back}
                showBack={contactStep > 0 || history.some((id) => !autoFilled.has(id))}
                onBack={goBack}
                onNext={() => goNext()}
                label={primaryLabel}
                submitting={submitting || thinking}
                busyLabel={thinking ? t.thinking : undefined}
                showCheck={!isLastStep && !autoAdvances}
                enterHint={enterHint}
              />
            </>
          )}

          {autoFilled.size > 0 && !entry && (
            <p className="text-xs text-(--st-muted)">
              {t.skippedKnown}{" "}
              <button
                type="button"
                onClick={answerKnownAgain}
                className="underline underline-offset-2"
              >
                {t.answerAgain}
              </button>
            </p>
          )}
          {savesProgress && currentIndex >= 0 && !entry && (
            <p className="text-xs text-(--st-muted)">
              {question.type === "contact_info" ? t.detailsSaved : t.savedAsYouGo}
            </p>
          )}
          {onFinishLater && !entry && history.length > 0 && (
            <FinishLater key={question.id} create={onFinishLater} label={t.finishLater} />
          )}
        </div>
      </Stage>
    </RuntimeStringsContext.Provider>
  );
}

/** A choice question's options as this respondent sees them: only the
 * carried-forward ones they're offered, and shuffled (fixed by the seed,
 * so a refresh doesn't reshuffle) when "Shuffle options" is on. */
function withDisplayOrder(
  question: QuestionV1,
  seed: string | undefined,
  answers: AnswerMap,
): QuestionV1 {
  const settings = question.settings as {
    options?: { id: string }[];
    randomizeOptions?: boolean;
  };
  if (!settings.options) return question;
  const available = availableOptionIds(question, answers);
  let options = available
    ? settings.options.filter((o) => available.has(o.id))
    : settings.options;
  if (settings.randomizeOptions && seed) {
    options = seededShuffle(options, `${seed}:${question.id}`);
  }
  if (options === settings.options) return question;
  return { ...question, settings: { ...settings, options } } as QuestionV1;
}

/** "Finish later" (PRD P2.8): makes a resume link and shows it to copy. */
function FinishLater({
  create,
  label,
}: {
  label: string;
  create: () => Promise<{ ok: true; url: string } | { ok: false; message: string }>;
}) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "pending" }
    | { kind: "link"; url: string; copied: boolean }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  if (state.kind === "link") {
    return (
      <div className="flex w-full max-w-[520px] flex-col gap-2 rounded-[10px] border border-(--st-line) p-3 text-[13.5px]">
        <label htmlFor="fc-resume-link" className="font-semibold">
          Your link to finish later
        </label>
        <div className="flex gap-2">
          <input
            id="fc-resume-link"
            readOnly
            value={state.url}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-[6px] border border-(--st-line) bg-transparent px-2.5 py-1.5 text-[13px]"
          />
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(state.url).then(
                () => setState({ ...state, copied: true }),
                () => undefined,
              );
            }}
            className="rounded-[6px] border border-(--st-primary) px-3 py-1.5 font-semibold text-(--st-primary)"
          >
            {state.copied ? "Copied" : "Copy"}
          </button>
        </div>
        <span className="text-xs text-(--st-muted)">
          Open it on any device within 30 days to pick up where you left off. Anyone with
          the link can see your answers, so keep it to yourself.
        </span>
      </div>
    );
  }
  return (
    <p className="text-xs text-(--st-muted)">
      <button
        type="button"
        disabled={state.kind === "pending"}
        onClick={async () => {
          setState({ kind: "pending" });
          const result = await create();
          setState(
            result.ok
              ? { kind: "link", url: result.url, copied: false }
              : { kind: "error", message: result.message },
          );
        }}
        className="font-semibold text-(--st-primary) underline underline-offset-2"
      >
        {state.kind === "pending" ? "…" : label}
      </button>
      {state.kind === "error" && <span role="alert"> {state.message}</span>}
    </p>
  );
}

/** An ending (Part 6 §6.4, Part 8 §3). With a redirect URL on the live
 * form: the response is already saved, so count down (the ending's or
 * the form's delay, 3s by default), then go in the same tab; if the
 * browser blocks it, the button stays. */
function EndingScreen({
  ending,
  brandingRemovable,
  scheduler,
  meta,
  recallSource,
  theme,
  mode,
  className,
  headingRef,
  redirect,
}: {
  ending: EndingV1;
  brandingRemovable: boolean;
  /** The booking page to show, already prefilled; null for none. */
  scheduler: string | null;
  meta: CompiledFormV1["schema"]["meta"];
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
  const destination = endingRedirect({ meta }, ending);
  const target =
    destination && recallSource
      ? renderRecallUrl(destination.url, recallSource)
      : destination?.url;
  // A booking page stays put: no countdown away from it (the button
  // still offers the redirect).
  const counting = redirect && !!target && !scheduler;
  const [secondsLeft, setSecondsLeft] = useState(destination?.delaySeconds ?? 0);
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
      madeWith={showsMadeWith(ending, brandingRemovable)}
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
        {scheduler && (
          <iframe
            src={scheduler}
            title="Book a time"
            className="h-[660px] w-full rounded-[10px] border border-(--st-line) bg-white"
          />
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
