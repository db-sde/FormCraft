"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { CompiledFormV1 } from "@/domains/forms/schema/compile";
import type { AnswerMap } from "@/domains/logic";
import { FormRuntime, type CompleteOutcome } from "@/components/runtime/form-runtime";
import { Button } from "@/components/ui/button";

type StoredResponse = {
  responseId: string;
  idempotencyKey: string;
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
  const data = (await res.json()) as { responseId: string };
  const fresh: StoredResponse = {
    responseId: data.responseId,
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
 * Resume: a response id + its last-known answers/position are cached
 * in localStorage per form. A refresh in the same browser picks up
 * exactly where the respondent left off instead of starting over. A
 * stale write (409 — e.g. the same response was advanced from another
 * tab/device) is treated as unrecoverable for this session: the cached
 * state is cleared and the page reloads into a fresh response, rather
 * than risking silently clobbering newer server state.
 */
export function PublicFormRuntime({
  formId,
  compiled,
}: {
  formId: string;
  compiled: CompiledFormV1;
}) {
  const [session, setSession] = useState<StoredResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sessionRef = useRef<StoredResponse | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      startPromiseRef.current = existing
        ? Promise.resolve(existing)
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
  }, [formId, firstQuestionId, attempt]);

  function retryStart() {
    startPromiseRef.current = null;
    setLoadFailed(false);
    setAttempt((a) => a + 1);
  }

  function handleAnswerChange(answers: AnswerMap, currentQuestionId: string) {
    const current = sessionRef.current;
    if (!current) return;

    const updated: StoredResponse = {
      ...current,
      answers,
      lastQuestionId: currentQuestionId,
    };
    sessionRef.current = updated;
    writeStored(formId, updated);

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void persist(updated), AUTOSAVE_DEBOUNCE_MS);
  }

  async function persist(toSave: StoredResponse) {
    const nextRevision = toSave.revision + 1;
    try {
      const res = await fetch(`/api/responses/${toSave.responseId}/answers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientRevision: nextRevision,
          lastQuestionId: toSave.lastQuestionId,
          answers: toSave.answers,
        }),
      });

      if (res.status === 409) {
        // Stale relative to the server — this browser's cached state
        // can no longer be trusted to continue from. Drop it and start
        // over rather than risk overwriting newer server-side state.
        clearStored(formId);
        window.location.reload();
        return;
      }
      if (!res.ok) return;

      const latest = sessionRef.current ?? toSave;
      const updated = { ...latest, revision: nextRevision };
      sessionRef.current = updated;
      writeStored(formId, updated);
    } catch {
      // Network hiccup — the next debounced save (or the final
      // complete call) will retry with the same/newer revision.
    }
  }

  async function handleComplete(answers: AnswerMap): Promise<CompleteOutcome> {
    const current = sessionRef.current;
    if (!current) {
      return { ok: false, message: "Your session expired. Please refresh the page." };
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    try {
      const res = await fetch(`/api/responses/${current.responseId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientRevision: current.revision + 1,
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
