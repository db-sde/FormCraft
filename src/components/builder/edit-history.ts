/**
 * The builder's undo/redo history (QA FC4-22): earlier versions of the
 * form, recorded as it changes. Quick runs of changes (typing a label)
 * make one step, so Undo takes back a whole edit, not a letter.
 */
export type EditHistory<T> = {
  /** Called after each change of the form; `undoing` when the change is
   * itself an undo or redo, which mustn't be recorded. */
  record: (previous: T, now?: number) => void;
  undo: (current: T) => T | null;
  redo: (current: T) => T | null;
  subscribe: (listener: () => void) => () => void;
  /** "undo count:redo count", for useSyncExternalStore. */
  snapshot: () => string;
};

/** Changes this close together are one step. */
export const STEP_GAP_MS = 800;
const MAX_STEPS = 100;

export function createEditHistory<T>(): EditHistory<T> {
  const past: T[] = [];
  let future: T[] = [];
  let lastChangeAt = -Infinity;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  return {
    record(previous, now = Date.now()) {
      // The first change of a burst keeps the form as it was before it.
      if (now - lastChangeAt >= STEP_GAP_MS) {
        past.push(previous);
        if (past.length > MAX_STEPS) past.shift();
      }
      lastChangeAt = now;
      future = [];
      emit();
    },
    undo(current) {
      const previous = past.pop();
      if (previous === undefined) return null;
      future.push(current);
      lastChangeAt = -Infinity;
      emit();
      return previous;
    },
    redo(current) {
      const next = future.pop();
      if (next === undefined) return null;
      past.push(current);
      lastChangeAt = -Infinity;
      emit();
      return next;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => `${past.length}:${future.length}`,
  };
}
