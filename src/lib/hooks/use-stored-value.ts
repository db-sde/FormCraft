"use client";

import { useCallback, useSyncExternalStore } from "react";

const EVENT = "fc-storage";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * A per-browser preference kept in localStorage (grid/list view, a
 * dismissed card…). Server rendering and the first client render use
 * `serverValue`, then the stored value takes over — no hydration
 * mismatch, no setState-in-effect. Storage being blocked just means the
 * value isn't remembered.
 */
export function useStoredValue(
  key: string,
  serverValue: string | null = null,
): [string | null, (value: string) => void] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const handler = (e: Event) => {
        if (e instanceof StorageEvent ? e.key === key : (e as CustomEvent).detail === key)
          onChange();
      };
      window.addEventListener("storage", handler);
      window.addEventListener(EVENT, handler);
      return () => {
        window.removeEventListener("storage", handler);
        window.removeEventListener(EVENT, handler);
      };
    },
    [key],
  );
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => serverValue,
  );
  const set = useCallback(
    (next: string) => {
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Not remembered — fine.
      }
      window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
    },
    [key],
  );
  return [value, set];
}
