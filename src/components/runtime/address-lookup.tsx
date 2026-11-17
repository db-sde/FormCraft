"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { AddressField } from "@/domains/forms/schema/question-types";

/**
 * Address suggestions (F-65) for the live form: which form they're for
 * (the server checks the question allows them) and the respondent's
 * language. Not provided in the builder's Preview, which makes no calls.
 */
export const AddressLookupContext = createContext<{
  formId: string;
  language?: string;
} | null>(null);

type Suggestion = { placeId: string; text: string; secondary?: string };

function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Suggestions for what's typed in the first address line. Any failure
 * (not set up, rate limited, unreachable) turns them off for the visit:
 * the respondent just keeps typing.
 */
export function useAddressSuggestions(questionId: string, enabled: boolean) {
  const lookup = useContext(AddressLookupContext);
  const active = enabled && !!lookup;
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const session = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/places", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        formId: lookup!.formId,
        questionId,
        language: lookup!.language?.slice(0, 2),
        sessionToken: (session.current ??= newSessionToken()),
        ...body,
      }),
    });
    if (!res.ok) {
      setUnavailable(true);
      setSuggestions([]);
      return null;
    }
    return res.json();
  }

  function search(text: string) {
    if (!active || unavailable) return;
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const call = ++latest.current;
    timer.current = setTimeout(async () => {
      const data = (await post({ action: "suggest", text }).catch(() => null)) as {
        suggestions?: Suggestion[];
      } | null;
      if (call === latest.current) setSuggestions(data?.suggestions ?? []);
    }, 250);
  }

  async function pick(
    placeId: string,
  ): Promise<Partial<Record<AddressField, string>> | null> {
    setSuggestions([]);
    const data = (await post({ action: "details", placeId }).catch(() => null)) as {
      address?: Partial<Record<AddressField, string>>;
    } | null;
    // The next search is a new billing session.
    session.current = null;
    return data?.address ?? null;
  }

  return {
    active: active && !unavailable,
    suggestions,
    search,
    pick,
    close: () => setSuggestions([]),
  };
}
