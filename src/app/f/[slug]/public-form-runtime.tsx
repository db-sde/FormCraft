"use client";

import { useEffect, useRef, useState } from "react";
import type { CompiledFormV1 } from "@/domains/forms/schema/compile";
import type { AnswerMap } from "@/domains/logic";
import { FormRuntime } from "@/components/runtime/form-runtime";

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
  const [loading, setLoading] = useState(true);
  const sessionRef = useRef<StoredResponse | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against calling /start twice for the same mount — React 18
  // Strict Mode runs effects twice in dev, and without this a fresh
  // (no-localStorage-yet) load would create two response rows for one
  // page view. Persists across the double-invocation because refs
  // survive StrictMode's mount→cleanup→remount of the same instance.
  const startInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const existing = readStored(formId);
      if (existing) {
        if (!cancelled) {
          sessionRef.current = existing;
          setSession(existing);
          setLoading(false);
        }
        return;
      }

      if (startInFlightRef.current) return;
      startInFlightRef.current = true;

      try {
        const res = await fetch("/api/responses/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ formId }),
        });
        if (!res.ok) throw new Error("failed to start response");
        const data = (await res.json()) as { responseId: string };

        const fresh: StoredResponse = {
          responseId: data.responseId,
          idempotencyKey: crypto.randomUUID(),
          revision: 0,
          answers: {},
          lastQuestionId: compiled.orderedQuestionIds[0] ?? "",
          history: [],
        };
        writeStored(formId, fresh);
        if (!cancelled) {
          sessionRef.current = fresh;
          setSession(fresh);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

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

      const updated = { ...toSave, revision: nextRevision };
      sessionRef.current = updated;
      writeStored(formId, updated);
    } catch {
      // Network hiccup — the next debounced save (or the final
      // complete call) will retry with the same/newer revision.
    }
  }

  async function handleComplete(_endingId: string, answers: AnswerMap) {
    const current = sessionRef.current;
    if (!current) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    try {
      await fetch(`/api/responses/${current.responseId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientRevision: current.revision + 1,
          lastQuestionId: current.lastQuestionId,
          answers,
          idempotencyKey: current.idempotencyKey,
        }),
      });
    } finally {
      clearStored(formId);
    }
  }

  if (loading || !session) {
    return <div className="min-h-[420px]" />;
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
    />
  );
}
