"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { CompiledFormV1 } from "@/domains/forms/schema/compile";
import type { AnswerMap } from "@/domains/logic";
import { FormRuntime, type CompleteOutcome } from "@/components/runtime/form-runtime";
import { Button } from "@/components/ui/button";

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
};

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

async function startSession(formId: string, firstQuestionId: string) {
  const res = await fetch("/api/responses/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ formId }),
  });
  if (!res.ok) throw new Error(`start failed: ${res.status}`);
  const data = (await res.json()) as { responseId: string; formVersionId: string };
  const fresh: StoredResponse = {
    responseId: data.responseId,
    formVersionId: data.formVersionId,
    idempotencyKey: crypto.randomUUID(),
    revision: 0,
    answers: {},
    lastQuestionId: firstQuestionId,
    history: [],
  };
  writeStored(formId, fresh);
  return fresh;
}

const AUTOSAVE_DEBOUNCE_MS = 600;

/**
 * Owns the network/localStorage side of the public response lifecycle
 * (start → debounced autosave → complete) and renders the shared
 * FormRuntime underneath. Kept separate from FormRuntime itself so
 * that component stays a pure, network-free renderer usable by the
 * builder's Preview dialog too (see form-runtime.tsx).
 *
 * Resume: a response id + its answers, position and back-history are
 * cached in localStorage per form, so a refresh picks up exactly where
 * the respondent left off.
 *
 * Autosave is single-flight: at most one save request is in the air,
 * and each claims a fresh revision before it's sent. (It used to reuse
 * the last *acknowledged* revision, so two overlapping saves carried the
 * same number, the server rejected one as stale, and the client's
 * response to that — wipe the session and reload — restarted the form
 * from question one a moment after the respondent answered.) A genuine
 * conflict now resyncs to the server's revision and saves again; the
 * respondent's progress is never thrown away.
 */
export function PublicFormRuntime({
  formId,
  formVersionId,
  compiled,
}: {
  formId: string;
  formVersionId: string;
  compiled: CompiledFormV1;
}) {
  const [session, setSession] = useState<StoredResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sessionRef = useRef<StoredResponse | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The in-flight save (if any), and whether newer changes arrived
  // while it was running and need their own save afterwards.
  const inFlightRef = useRef<Promise<void> | null>(null);
  const dirtyRef = useRef(false);
  // One /start request per attempt, shared by every effect run. React
  // Strict Mode mounts → cleans up → remounts in dev: the first run's
  // result must still reach whichever run is current, or the page
  // stays blank forever (a real bug: an earlier "skip if in flight"
  // guard dropped the result on the floor). Refs survive that remount.
  const startPromiseRef = useRef<Promise<StoredResponse> | null>(null);

  const theme = compiled.schema.theme;
  const firstQuestionId = compiled.orderedQuestionIds[0] ?? "";

  useEffect(() => {
    let cancelled = false;

    if (!startPromiseRef.current) {
      const existing = readStored(formId);
      // A response started against an older published version can't be
      // continued on the new one — its question ids may not exist.
      const resumable =
        existing &&
        (existing.formVersionId === undefined ||
          existing.formVersionId === formVersionId);
      startPromiseRef.current = resumable
        ? Promise.resolve({ ...existing, history: existing.history ?? [] })
        : startSession(formId, firstQuestionId);
    }
    startPromiseRef.current.then(
      (fresh) => {
        if (cancelled) return;
        sessionRef.current = fresh;
        setSession(fresh);
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [formId, formVersionId, firstQuestionId, attempt]);

  function retryStart() {
    startPromiseRef.current = null;
    setLoadFailed(false);
    setAttempt((a) => a + 1);
  }

  function updateSession(patch: Partial<StoredResponse>) {
    const current = sessionRef.current;
    if (!current) return null;
    const updated = { ...current, ...patch };
    sessionRef.current = updated;
    writeStored(formId, updated);
    return updated;
  }

  function handleAnswerChange(
    answers: AnswerMap,
    currentQuestionId: string,
    history: string[],
  ) {
    if (!updateSession({ answers, lastQuestionId: currentQuestionId, history })) return;
    dirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void flushSaves(), AUTOSAVE_DEBOUNCE_MS);
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
    if (!sessionRef.current) {
      return { ok: false, message: "Your session expired. Please refresh the page." };
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    // Let any in-flight autosave land first; the submit carries every
    // answer itself, so pending (unsent) changes don't need their own save.
    dirtyRef.current = false;
    await inFlightRef.current?.catch(() => undefined);
    const current = updateSession({
      answers,
      revision: (sessionRef.current?.revision ?? 0) + 1,
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
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { endingId: string };
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

  const shellStyle: React.CSSProperties = {
    backgroundColor: theme.backgroundColor,
    color: theme.textColor ?? undefined,
  };

  if (loadFailed) {
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center"
        style={shellStyle}
      >
        <p className="text-lg font-medium">This form couldn&apos;t be loaded.</p>
        <p className="max-w-sm text-sm opacity-70">
          It may have just been unpublished, or your connection dropped.
        </p>
        <Button type="button" variant="outline" onClick={retryStart}>
          Try again
        </Button>
      </div>
    );
  }

  if (!session) {
    return (
      <div
        className="flex min-h-dvh items-center justify-center"
        style={shellStyle}
        aria-busy="true"
      >
        <Loader2 className="size-6 animate-spin opacity-50" aria-label="Loading form" />
      </div>
    );
  }

  return (
    <FormRuntime
      compiled={compiled}
      initialAnswers={session.answers}
      initialQuestionId={session.lastQuestionId}
      initialHistory={session.history}
      onAnswerChange={handleAnswerChange}
      onComplete={handleComplete}
      responseId={session.responseId}
      className="min-h-dvh"
    />
  );
}
