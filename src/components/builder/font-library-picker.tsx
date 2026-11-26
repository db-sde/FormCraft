"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { LibraryFont } from "@/domains/themes/font-library";
import { cn } from "cn";

const CATEGORIES = [
  { value: "all", label: "All" },
  { value: "sans", label: "Sans" },
  { value: "serif", label: "Serif" },
  { value: "display", label: "Display" },
  { value: "handwriting", label: "Script" },
  { value: "mono", label: "Mono" },
] as const;
const SHOWN = 60;

/**
 * The font library picker (pricing doc: 1,700+ fonts, every plan). The
 * list loads when the picker opens; the chosen font is previewed from
 * FormCraft's own /fonts route, which is what respondents load too.
 */
export function FontLibraryPicker({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (family: string) => void;
}) {
  const [fonts, setFonts] = useState<LibraryFont[] | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["value"]>("all");

  useEffect(() => {
    let live = true;
    void import("@/domains/themes/font-library").then((m) => {
      if (live) setFonts(m.libraryFonts());
    });
    return () => {
      live = false;
    };
  }, []);

  const matches = useMemo(() => {
    if (!fonts) return [];
    const q = query.trim().toLowerCase();
    return fonts.filter(
      (f) =>
        (category === "all" || f.category === category) &&
        (!q || f.family.toLowerCase().includes(q)),
    );
  }, [fonts, query, category]);

  return (
    <div className="col-span-full flex flex-col gap-2">
      {value && (
        <>
          <link
            rel="stylesheet"
            href={`/fonts/css?family=${encodeURIComponent(value)}`}
          />
          <p
            className="border-input rounded-sm border-[1.5px] px-3 py-2.5 text-[17px] leading-snug"
            style={{ fontFamily: `"${value}", var(--font-inter), sans-serif` }}
          >
            {value}: How did you hear about us?
          </p>
        </>
      )}
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          aria-label="Search fonts"
          placeholder={
            fonts ? `Search ${fonts.length.toLocaleString()} fonts` : "Loading fonts…"
          }
          className="h-[38px] pl-8"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Font style">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={category === c.value}
            onClick={() => setCategory(c.value)}
            className={cn(
              "fc-focus h-7 rounded-[5px] border-[1.5px] px-2.5 text-[12.5px] font-semibold",
              category === c.value
                ? "border-foreground bg-foreground text-background"
                : "border-input",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      <ul
        className="border-input max-h-[240px] overflow-y-auto rounded-sm border-[1.5px]"
        aria-label="Fonts"
      >
        {matches.slice(0, SHOWN).map((f) => (
          <li key={f.family}>
            <button
              type="button"
              onClick={() => onChange(f.family)}
              aria-pressed={f.family === value}
              className="fc-focus hover:bg-muted flex w-full items-center justify-between px-3 py-1.5 text-left text-[13.5px]"
            >
              {f.family}
              {f.family === value && <Check className="size-[13px]" />}
            </button>
          </li>
        ))}
        {fonts && matches.length === 0 && (
          <li className="text-muted-foreground px-3 py-2 text-[13px]">No fonts match.</li>
        )}
        {matches.length > SHOWN && (
          <li className="text-muted-foreground px-3 py-2 text-[12.5px]">
            {(matches.length - SHOWN).toLocaleString()} more. Search to narrow it down.
          </li>
        )}
      </ul>
    </div>
  );
}
