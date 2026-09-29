"use client";

import { useState } from "react";
import { toast } from "sonner";

/**
 * The form's name, editable in place. Commits on blur or Enter; Escape
 * reverts. Renaming updates the dashboard name (via `onRename`) and the
 * draft's meta.title (via `onTitleChange`, autosaved with the rest of
 * the draft) so the public page title follows on the next publish.
 */
export function FormTitleInput({
  title,
  onRename,
  onTitleChange,
}: {
  title: string;
  onRename: (
    title: string,
  ) => Promise<{ ok: true; title: string } | { ok: false; message: string }>;
  onTitleChange: (title: string) => void;
}) {
  const [value, setValue] = useState(title);
  const [committed, setCommitted] = useState(title);

  async function commit() {
    const next = value.trim();
    if (!next) {
      setValue(committed);
      return;
    }
    if (next === committed) return;

    const previous = committed;
    setCommitted(next);
    onTitleChange(next);
    const result = await onRename(next);
    if (!result.ok) {
      setCommitted(previous);
      setValue(previous);
      onTitleChange(previous);
      toast.error(result.message);
    }
  }

  return (
    <input
      aria-label="Form name"
      value={value}
      maxLength={200}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          const input = e.currentTarget;
          setValue(committed);
          // Blur after the reverted value has rendered, so the blur's
          // commit sees no change instead of saving the edit.
          requestAnimationFrame(() => input.blur());
        }
      }}
      className="hover:border-input focus:border-ring min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium outline-none sm:max-w-xs"
    />
  );
}
