"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";

/** Searches leads as you type (after a short pause), keeping the form
 * filter. Enter still searches at once, and it works without scripts. */
export function LeadsSearch({ formId, initial }: { formId?: string; initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function hrefFor(q: string) {
    const params = new URLSearchParams();
    if (formId) params.set("form", formId);
    if (q.trim()) params.set("q", q.trim());
    const query = params.toString();
    return query ? `/leads?${query}` : "/leads";
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <form
      action="/leads"
      className="flex-1 sm:max-w-xs"
      onSubmit={(e) => {
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        router.replace(hrefFor(value));
      }}
    >
      {formId && <input type="hidden" name="form" value={formId} />}
      <Input
        type="search"
        name="q"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => router.replace(hrefFor(next)), 250);
        }}
        placeholder="Search name, email, phone…"
        aria-label="Search leads"
      />
    </form>
  );
}
