"use client";

import { useSyncExternalStore } from "react";

/**
 * Answers still being saved in the background (a signature uploading
 * after the last stroke). Moving on waits for them, so pressing OK while
 * a drawn signature shows "Saving…" doesn't say it's missing (QA FC4-16).
 */
let pending = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Marks one save as started; call the returned function when it ends
 * (safe to call more than once). */
export function beginPendingSave(): () => void {
  pending += 1;
  emit();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    pending -= 1;
    emit();
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** How many saves are still running. */
export function usePendingSaves(): number {
  return useSyncExternalStore(
    subscribe,
    () => pending,
    () => 0,
  );
}
