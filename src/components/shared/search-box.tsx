"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";

/**
 * A search field that updates the page's URL as you type (after a short
 * pause), keeping the page's other filters and going back to page 1.
 * Enter searches at once; without scripts it's a plain GET form.
 */
export function SearchBox({
  baseHref,
  param = "q",
  initial,
  placeholder,
  label,
  className,
}: {
  /** The current page's URL without this search or a page number. */
  baseHref: string;
  param?: string;
  initial: string;
  placeholder: string;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  // A search that takes a while says so, and the newest one always wins
  // (QA FC15-60: results seemed a keystroke behind while one loaded).
  const [searching, startSearch] = useTransition();
  const go = (text: string) => startSearch(() => router.replace(hrefFor(text)));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [path, query = ""] = baseHref.split("?");
  const kept = [...new URLSearchParams(query)];

  function hrefFor(text: string) {
    const params = new URLSearchParams(query);
    if (text.trim()) params.set(param, text.trim());
    else params.delete(param);
    const s = params.toString();
    return s ? `${path}?${s}` : path;
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <form
      action={path}
      className={className}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        go(value);
      }}
    >
      {kept.map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Input
        type="search"
        name={param}
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => go(next), 250);
        }}
        placeholder={placeholder}
        aria-label={label}
        maxLength={100}
        aria-busy={searching || undefined}
      />
      {searching && (
        <span role="status" className="text-muted-foreground mt-1 block text-xs">
          Searching…
        </span>
      )}
    </form>
  );
}
