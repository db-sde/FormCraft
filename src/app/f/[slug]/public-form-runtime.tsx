"use client";

import { useEffect, useRef, useState } from "react";
import type { CompiledFormV1 } from "@/domains/forms/schema/compile";
import type { AnswerMap } from "@/domains/logic";
import { Stage } from "@/components/runtime/stage";
import { FormRuntime, type CompleteOutcome } from "@/components/runtime/form-runtime";
import type { ResumeResult } from "@/domains/responses/resume";
import { newSeed } from "@/domains/logic/random";

const RESUME_NOTICE: Record<Exclude<ResumeResult, { ok: true }>["reason"], string> = {
  invalid: "That link doesn't work, so you're starting fresh.",
  expired: "That link has expired, so you're starting fresh.",
  submitted: "Those answers were already submitted. You can fill the form again.",
  changed: "The form has changed since, so you're starting fresh.",
  disabled: "That link no longer works, so you're starting fresh.",
};

type StoredResponse = {
  responseId: string;
  /** The published version this response is bound to — a republish
   * starts a fresh response rather than mixing two schemas. */
  formVersionId?: string;
  idempotencyKey: string;
  /** Last revision this browser *claimed* for a write (sent or about to
   * be sent), not the last one acknowledged. Claiming before sending is
   * what makes overlapping saves impossible to collide. */
  revision: number;
  answers: AnswerMap;
  lastQuestionId: string;
  history: string[];
  /** The hidden-field values this session started with. */
  hidden?: Record<string, string>;
  /** Random seed for question pools and option order (kept on resume). */
  seed?: string;
};

/** What the respondent has done so far, before or after a response
 * row exists. */
type Progress = Pick<StoredResponse, "answers" | "lastQuestionId" | "history">;

function storageKey(formId: string) {
  return `formcraft:response:${formId}`;
}

function readStored(formId: string): StoredResponse | null {
  try {
    const raw = localStorage.getItem(storageKey(formId));
    if (!raw) return null;
    return JSON.parse(raw) as StoredResponse;
  } catch {
    return null;
  }
}

function writeStored(formId: string, value: StoredResponse) {
  try {
    localStorage.setItem(storageKey(formId), JSON.stringify(value));
  } catch {
    // Private browsing / storage disabled — the session still works,
    // it just won't survive a refresh. Not fatal.
  }
}

function clearStored(formId: string) {
  try {
    localStorage.removeItem(storageKey(formId));
  } catch {
    // ignore
  }
}

/** Where this visit came from (PRD P2.11) — the page URL's UTM
 * parameters and the referring page. Respondent-controlled, so it's
 * only ever stored and displayed, never trusted for anything else. */
function attribution() {
  const params = new URLSearchParams(window.location.search);
  const pick = (key: string) => params.get(key)?.slice(0, 200) || undefined;
  return {
    referrer: document.referrer ? document.referrer.slice(0, 2000) : undefined,
    utmSource: pick("utm_source"),
    utmMedium: pick("utm_medium"),
    utmCampaign: pick("utm_campaign"),
    utmTerm: pick("utm_term"),
    utmContent: pick("utm_content"),
    embedded: params.get("embed") === "1",
  };
}

/** Values for the form's declared hidden fields from the page URL
 * (`?source=linkedin`). Respondent-controlled: for routing and
 * personalisation only; the server keeps declared names only. */
function hiddenFromUrl(compiled: CompiledFormV1): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  for (const field of compiled.schema.hiddenFields ?? []) {
    const value = params.get(field.name);
    if (value) out[field.name] = value.slice(0, 500);
  }
  return out;
}

async function startSession(
  formId: string,
  hidden: Record<string, string>,
  seed: string,
): Promise<{
  responseId: string;
  formVersionId: string;
}> {
  const res = await fetch("/api/responses/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ formId, ...attribution(), hidden, seed }),
  });
  if (!res.ok) throw new Error(`start failed: ${res.status}`);
  return (await res.json()) as { responseId: string; formVersionId: string };
}

const AUTOSAVE_DEBOUNCE_MS = 600;
/** How long to leave the server alone after a failed start. */
const START_RETRY_COOLDOWN_MS = 5000;

/**
 * Owns the network/localStorage side of the public response lifecycle
 * (start → debounced autosave → complete) and renders the shared
 * FormRuntime underneath. Kept separate from FormRuntime itself so
 * that component stays a pure, network-free renderer usable by the
 * builder's Preview dialog too (see form-runtime.tsx).
 *
 * Start: the response row is created on the respondent's first real
 * interaction — pressing Start, typing, choosing — not on page load
 * (PRD: a "form start" is the first interaction). Visitors who only look
 * count as views, never as starts or empty responses.
 *
 * Resume: a response id + its answers, position and back-history are
 * cached in localStorage per form, so a refresh picks up exactly where
 * the respondent left off.
 *
 * Autosave is single-flight: at most one save request is in the air,
 * and each claims a fresh revision before it's sent (reusing the last
 * acknowledged revision once let two overlapping saves collide, and the
 * old reaction — wipe and reload — restarted the form). A conflict
 * resyncs to the server's revision and saves again.
 *
 * When the creator has turned off saving unfinished responses,
 * nothing is written anywhere (server or this browser) until submit.
 */
export function PublicFormRuntime({
  formId,
  formVersionId,
  compiled,
  savesProgress = true,
  embedded = false,
  resumeLinks = false,
  resume = null,
  brandingRemovable = true,
}: {
  /** From the workspace's plan, decided on the server (P2.1). */
  brandingRemovable?: boolean;
  /** Creator setting: respondents can get a link to finish later (P2.8). */
  resumeLinks?: boolean;
  /** A resume link this page was opened with, already checked on the server. */
  resume?: ResumeResult | null;
  /** Rendered inside another site's iframe (Share → Embed). */
  embedded?: boolean;
  formId: string;
  formVersionId: string;
  compiled: CompiledFormV1;
  /** Creator setting: keep answers from respondents who don't finish. */
  savesProgress?: boolean;
}) {
  // undefined = still checking this browser for a session to resume.
  const [resumed, setResumed] = useState<StoredResponse | null | undefined>(undefined);
  const sessionRef = useRef<StoredResponse | null>(null);
  const progressRef = useRef<Progress>({
    answers: {},
    lastQuestionId: compiled.orderedQuestionIds[0] ?? "",
    history: [],
  });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The in-flight save (if any), and whether newer changes arrived
  // while it was running and need their own save afterwards.
  const inFlightRef = useRef<Promise<void> | null>(null);
  const dirtyRef = useRef(false);
  // Refs survive React Strict Mode's mount → unmount → mount in dev, so
  // both runs share one localStorage read and one /start request.
  const resumeCheckRef = useRef<Promise<StoredResponse | null> | null>(null);
  const startPromiseRef = useRef<Promise<StoredResponse> | null>(null);
  const startFailedAtRef = useRef(0);
  // Read once: a resumed session keeps the values it started with.
  const [urlHidden] = useState<Record<string, string>>(() =>
    typeof window === "undefined" ? {} : hiddenFromUrl(compiled),
  );

  // A new respondent's seed; a resumed session keeps the one it had.
  const [freshSeed] = useState(newSeed);

  const theme = compiled.schema.theme;

  useEffect(() => {
    if (!embedded || window.parent === window) return;
    const report = () =>
      window.parent.postMessage(
        {
          type: "formcraft:height",
          formId,
          height: document.documentElement.scrollHeight,
        },
        "*",
      );
    const observer = new ResizeObserver(report);
    observer.observe(document.body);
    report();
    return () => observer.disconnect();
  }, [embedded, formId]);

  useEffect(() => {
    let cancelled = false;
    if (!resumeCheckRef.current && resume) {
      // The link's token shouldn't linger in the address bar, history or
      // a later page's referrer.
      const url = new URL(window.location.href);
      url.searchParams.delete("resume");
      window.history.replaceState(null, "", url);
    }
    if (!resumeCheckRef.current && resume?.ok) {
      const fromLink: StoredResponse = {
        ...resume.response,
        idempotencyKey: crypto.randomUUID(),
      };
      if (savesProgress) writeStored(formId, fromLink);
      resumeCheckRef.current = Promise.resolve(fromLink);
    }
    if (!resumeCheckRef.current && resume && !resume.ok) {
      // A link that no longer works starts fresh, as its note says —
      // including over this browser's copy of that same response.
      clearStored(formId);
      resumeCheckRef.current = Promise.resolve(null);
    }
    if (!resumeCheckRef.current) {
      const existing = savesProgress ? readStored(formId) : null;
      // A response started against an older published version can't be
      // continued on the new one — its question ids may not exist.
      const resumable =
        existing &&
        (existing.formVersionId === undefined || existing.formVersionId === formVersionId)
          ? { ...existing, history: existing.history ?? [] }
          : null;
      resumeCheckRef.current = Promise.resolve(resumable);
    }
    void resumeCheckRef.current.then((existing) => {
      if (cancelled) return;
      sessionRef.current = existing;
      if (existing) {
        progressRef.current = {
          answers: existing.answers,
          lastQuestionId: existing.lastQuestionId,
          history: existing.history,
        };
      }
      setResumed(existing);
    });
    return () => {
      cancelled = true;
    };
  }, [formId, formVersionId, savesProgress, resume]);

  function updateSession(patch: Partial<StoredResponse>) {
    const current = sessionRef.current;
    if (!current) return null;
    const updated = { ...current, ...patch };
    sessionRef.current = updated;
    if (savesProgress) writeStored(formId, updated);
    return updated;
  }

  /** The response row, created on first need and shared by everyone
   * who asks while it's being created. A failed start is retried on the
   * next call. */
  function ensureSession(options?: { force?: boolean }): Promise<StoredResponse> {
    if (sessionRef.current) return Promise.resolve(sessionRef.current);
    // After a failure, don't re-ask on every answer (that would hammer a
    // struggling server and eat the rate limit). Submitting always tries.
    if (
      !options?.force &&
      !startPromiseRef.current &&
      Date.now() - startFailedAtRef.current < START_RETRY_COOLDOWN_MS
    ) {
      return Promise.reject(new Error("start recently failed"));
    }
    if (!startPromiseRef.current) {
      startPromiseRef.current = startSession(formId, urlHidden, freshSeed).then(
        (data) => {
          const fresh: StoredResponse = {
            responseId: data.responseId,
            formVersionId: data.formVersionId,
            idempotencyKey: crypto.randomUUID(),
            revision: 0,
            hidden: urlHidden,
            seed: freshSeed,
            ...progressRef.current,
          };
          sessionRef.current = fresh;
          if (savesProgress) writeStored(formId, fresh);
          pixel("start");
          return fresh;
        },
        (error: unknown) => {
          startPromiseRef.current = null;
          startFailedAtRef.current = Date.now();
          throw error;
        },
      );
    }
    return startPromiseRef.current;
  }

  function handleAnswerChange(
    answers: AnswerMap,
    currentQuestionId: string,
    history: string[],
  ) {
    progressRef.current = { answers, lastQuestionId: currentQuestionId, history };
    ensureSession().then(
      () => {
        updateSession(progressRef.current);
        if (!savesProgress) return;
        dirtyRef.current = true;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => void flushSaves(), AUTOSAVE_DEBOUNCE_MS);
      },
      () => {
        // Offline for now — the next change (or the submit) tries again.
      },
    );
  }

  /** Saves until nothing is dirty, one request at a time. */
  function flushSaves(): Promise<void> {
    if (inFlightRef.current) return inFlightRef.current;
    const run = (async () => {
      while (dirtyRef.current) {
        dirtyRef.current = false;
        await saveLatest();
      }
    })().finally(() => {
      inFlightRef.current = null;
    });
    inFlightRef.current = run;
    return run;
  }

  async function saveLatest(retriesLeft = 2): Promise<void> {
    const current = sessionRef.current;
    if (!current) return;
    // Claim the revision before sending so no other request reuses it.
    const claimed = updateSession({ revision: current.revision + 1 });
    if (!claimed) return;

    try {
      const res = await fetch(`/api/responses/${claimed.responseId}/answers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientRevision: claimed.revision,
          lastQuestionId: claimed.lastQuestionId,
          answers: claimed.answers,
        }),
      });

      if (res.status === 409 && retriesLeft > 0) {
        // The server already holds a newer revision (e.g. this response
        // is open in another tab). Jump past it and save again — these
        // are the respondent's own answers either way.
        const body = (await res.json().catch(() => null)) as {
          currentRevision?: number;
        } | null;
        const serverRevision = body?.currentRevision ?? claimed.revision;
        updateSession({
          revision: Math.max(sessionRef.current?.revision ?? 0, serverRevision),
        });
        await saveLatest(retriesLeft - 1);
        return;
      }
      if (res.status === 404) {
        // The response itself is gone — nothing to continue.
        clearStored(formId);
        return;
      }
      if (!res.ok) dirtyRef.current = true; // retried on the next change / submit
    } catch {
      // Network hiccup — keep it dirty so the next save/submit carries it.
      dirtyRef.current = true;
    }
  }

  async function handleComplete(answers: AnswerMap): Promise<CompleteOutcome> {
    progressRef.current = { ...progressRef.current, answers };
    let session: StoredResponse;
    try {
      session = await ensureSession({ force: true });
    } catch {
      return {
        ok: false,
        message: "Couldn't reach the server — check your connection and try again.",
      };
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    // Let any in-flight autosave land first; the submit carries every
    // answer itself, so pending (unsent) changes don't need their own save.
    dirtyRef.current = false;
    await inFlightRef.current?.catch(() => undefined);
    const current = updateSession({
      answers,
      revision: (sessionRef.current?.revision ?? session.revision) + 1,
    });
    if (!current) {
      return { ok: false, message: "Your session expired. Please refresh the page." };
    }

    try {
      const res = await fetch(`/api/responses/${current.responseId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientRevision: current.revision,
          lastQuestionId: current.lastQuestionId,
          answers,
          // Same key on every retry: a submit whose response was lost
          // in transit is recognised server-side, never duplicated.
          idempotencyKey: current.idempotencyKey,
          // Spam trap (see FormRuntime): real respondents never fill it.
          trap: honeypotValue(),
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { endingId: string };
        pixel("submit");
        // Only now is the response durably complete — clearing earlier
        // would lose the respondent's answers if the submit failed.
        clearStored(formId);
        return { ok: true, endingId: data.endingId };
      }

      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string; errors?: { questionId: string; message: string }[] };
      } | null;
      if (res.status === 429) {
        return {
          ok: false,
          message: "Too many attempts. Please wait a moment and try again.",
        };
      }
      return {
        ok: false,
        message:
          body?.error?.message ?? "We couldn't submit your answers. Please try again.",
        errors: body?.error?.errors,
      };
    } catch {
      return {
        ok: false,
        message: "Couldn't reach the server — check your connection and try again.",
      };
    }
  }

  async function finishLater(): Promise<
    { ok: true; url: string } | { ok: false; message: string }
  > {
    try {
      const session = await ensureSession({ force: true });
      // The link should open with everything answered so far.
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      dirtyRef.current = true;
      await flushSaves();
      const res = await fetch(`/api/responses/${session.responseId}/resume-link`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => null)) as {
        path?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok || !body?.path) {
        return {
          ok: false,
          message: body?.error?.message ?? "Couldn't make a link. Try again.",
        };
      }
      return { ok: true, url: new URL(body.path, window.location.origin).toString() };
    } catch {
      return { ok: false, message: "Couldn't reach the server. Try again." };
    }
  }

  function sendStepEvent(
    type: "question_viewed" | "question_answered",
    questionId: string,
  ) {
    // Fire-and-forget; keepalive lets it finish even if the page closes.
    void fetch("/api/responses/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        formId,
        questionId,
        type,
        responseId: sessionRef.current?.responseId,
      }),
    }).catch(() => undefined);
  }

  if (resumed === undefined) {
    // Loading: the themed background plus a spinner (Part 6 §6.1).
    return (
      <Stage
        theme={theme}
        aria-busy="true"
        className={embedded ? "min-h-[480px]" : "min-h-dvh"}
      >
        <div
          role="status"
          className="flex flex-col items-center gap-3.5 text-(--st-primary)"
        >
          <span className="size-9 animate-spin rounded-full border-[3px] border-current border-t-transparent" />
          <span className="text-sm text-(--st-muted)">Loading…</span>
        </div>
      </Stage>
    );
  }

  return (
    <FormRuntime
      compiled={compiled}
      initialAnswers={resumed?.answers}
      initialQuestionId={resumed?.lastQuestionId}
      initialHistory={resumed?.history}
      welcomeBack={!!resumed && !!resumed.lastQuestionId}
      hidden={resumed?.hidden ?? urlHidden}
      seed={resumed?.seed ?? freshSeed}
      brandingRemovable={brandingRemovable}
      redirectOnEnding
      onAnswerChange={handleAnswerChange}
      onComplete={handleComplete}
      getResponseId={() => ensureSession().then((s) => s.responseId)}
      savesProgress={savesProgress}
      onStepEvent={sendStepEvent}
      onFinishLater={resumeLinks && savesProgress ? finishLater : undefined}
      notice={resume && !resume.ok ? RESUME_NOTICE[resume.reason] : undefined}
      // Embedded: natural height, reported to the host page so its
      // iframe grows/shrinks to fit (full-viewport height would pin the
      // iframe at whatever size it started with).
      className={embedded ? "min-h-[480px]" : "min-h-dvh"}
    />
  );
}

/** Tells the creator's analytics pixels (if the form has any, see
 * tracking-scripts.tsx) about a start or a submit — never answers. */
function pixel(event: "start" | "submit") {
  try {
    (window as { formcraftTrack?: (e: string) => void }).formcraftTrack?.(event);
  } catch {
    // Third-party scripts must never affect the form.
  }
}

/** Reads the hidden spam-trap field FormRuntime renders. */
function honeypotValue(): string | undefined {
  const field = document.querySelector<HTMLInputElement>('input[name="zq7_hp"]');
  return field?.value || undefined;
}
