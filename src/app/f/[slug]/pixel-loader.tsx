"use client";

import { useEffect, useState } from "react";
import type { Snippet } from "./pixels";

const storageKey = (formId: string) => `formcraft:pixels:${formId}`;

function readChoice(formId: string): "yes" | "no" | null {
  try {
    const v = localStorage.getItem(storageKey(formId));
    return v === "yes" || v === "no" ? v : null;
  } catch {
    return null;
  }
}

function inject(snippets: Snippet[], track: string, nonce: string | undefined) {
  const add = (snippet: Snippet | { key: string; code: string }) => {
    if (document.getElementById(snippet.key)) return;
    const el = document.createElement("script");
    el.id = snippet.key;
    if (nonce) el.nonce = nonce;
    if ("src" in snippet && snippet.src) {
      el.src = snippet.src;
      el.async = true;
    } else if (snippet.code) {
      el.text = snippet.code;
    }
    document.head.appendChild(el);
  };
  add({ key: "fc-track", code: track });
  for (const snippet of snippets) add(snippet);
}

/**
 * Loads the form's pixels in the browser (F-44): not at all under Global
 * Privacy Control; straight away when the creator doesn't ask for
 * consent; otherwise after the respondent allows it (remembered per form
 * in this browser). Declining loads nothing, so no conversion is sent.
 */
export function PixelLoader({
  formId,
  nonce,
  consent,
  snippets,
  track,
}: {
  formId: string;
  nonce?: string;
  consent: "none" | "ask";
  snippets: Snippet[];
  track: string;
}) {
  const [ask, setAsk] = useState(false);

  useEffect(() => {
    const gpc = (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl;
    if (gpc) return;
    if (consent === "none" || readChoice(formId) === "yes") {
      inject(snippets, track, nonce);
      return;
    }
    // Asking is a choice the page makes after it loads; nothing has
    // loaded before the answer.
    if (readChoice(formId) === null) {
      const timer = setTimeout(() => setAsk(true), 0);
      return () => clearTimeout(timer);
    }
  }, [consent, formId, nonce, snippets, track]);

  if (!ask) return null;
  const choose = (choice: "yes" | "no") => {
    try {
      localStorage.setItem(storageKey(formId), choice);
    } catch {
      // Not remembered; asked again next time.
    }
    setAsk(false);
    if (choice === "yes") inject(snippets, track, nonce);
  };
  return (
    <div
      role="dialog"
      aria-label="Cookies on this form"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-xl border border-black/10 bg-white px-4 py-3 text-[14px] text-[#1f1a16] shadow-lg"
    >
      <p className="min-w-0 flex-1">
        This form uses analytics and advertising cookies to measure visits. No answers are
        shared. Allow them?
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => choose("no")}
          className="rounded-md border border-black/15 px-3 py-1.5 font-semibold"
        >
          No thanks
        </button>
        <button
          type="button"
          onClick={() => choose("yes")}
          className="rounded-md bg-[#1f1a16] px-3 py-1.5 font-semibold text-white"
        >
          Allow
        </button>
      </div>
    </div>
  );
}
