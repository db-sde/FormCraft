"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { LibraryFont } from "@/domains/themes/font-library";
import { SCRIPT_LABEL, type FontScript } from "@/domains/themes/font-metadata";
import { listBrandThemesAction } from "@/app/(form)/forms/[id]/brand-theme-actions";
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
const RECENT_KEY = "fc-recent-fonts";

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

function rememberRecent(family: string) {
  try {
    const next = [family, ...readRecent().filter((f) => f !== family)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private mode: nothing to remember.
  }
}

/**
 * The font library picker (developer spec item 3: 1,700+ fonts, every
 * plan): search, style and script filters, most popular first, with this
 * workspace's brand fonts and recently used ones at the top. Only fonts
 * that can show every language of the form are offered. The chosen font
 * is previewed with the form's own title, from FormCraft's /fonts route
 * (what respondents load too).
 */
export function FontLibraryPicker({
  value,
  onChange,
  previewText = "",
  scripts = [],
  weight = 400,
}: {
  value: string | undefined;
  onChange: (family: string) => void;
  previewText?: string;
  /** Scripts the form's languages need. */
  scripts?: FontScript[];
  weight?: number;
}) {
  const [fonts, setFonts] = useState<LibraryFont[] | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["value"]>("all");
  const neededKey = scripts.filter((s) => s !== "latin").join(",");
  const needed = useMemo(
    () => (neededKey ? (neededKey.split(",") as FontScript[]) : []),
    [neededKey],
  );
  const [script, setScript] = useState<FontScript | "any">(needed[0] ?? "any");
  const [recent, setRecent] = useState<string[]>([]);
  const [brand, setBrand] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    void import("@/domains/themes/font-library").then((m) => {
      if (!live) return;
      setFonts(m.libraryFonts());
      setRecent(readRecent());
    });
    listBrandThemesAction()
      .then((rows) => {
        if (!live) return;
        const names = rows.flatMap((r) => [
          r.theme.fontFamily === "library" ? r.theme.libraryFont : undefined,
          r.theme.headingFont,
        ]);
        setBrand([...new Set(names.filter((n): n is string => Boolean(n)))]);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const matches = useMemo(() => {
    if (!fonts) return [];
    const q = query.trim().toLowerCase();
    const list = fonts.filter(
      (f) =>
        (category === "all" || f.category === category) &&
        (script === "any" || f.scripts.includes(script)) &&
        needed.every((s) => f.scripts.includes(s)) &&
        (!q || f.family.toLowerCase().includes(q)),
    );
    if (q) return list;
    // Brand, then recently used, then by popularity.
    const top = [...brand, ...recent];
    const rank = (f: LibraryFont) => {
      const i = top.indexOf(f.family);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...list].sort((a, b) => rank(a) - rank(b));
  }, [fonts, query, category, script, brand, recent, needed]);

  function pick(family: string) {
    rememberRecent(family);
    setRecent(readRecent());
    onChange(family);
  }

  return (
    <div className="col-span-full flex flex-col gap-2">
      {value && (
        <>
          <link
            rel="stylesheet"
            href={`/fonts/css?family=${encodeURIComponent(value)}&w=${weight}`}
          />
          <p
            className="border-input rounded-sm border-[1.5px] px-3 py-2.5 text-[17px] leading-snug"
            style={{
              fontFamily: `"${value}", var(--font-inter), sans-serif`,
              fontWeight: weight,
            }}
          >
            {previewText.trim() || "How did you hear about us?"}
            <span className="text-muted-foreground mt-1 block font-sans text-xs font-normal">
              {value}
            </span>
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
      <div
        className="flex flex-wrap items-center gap-1"
        role="group"
        aria-label="Font style"
      >
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
        <select
          aria-label="Script"
          value={script}
          onChange={(e) => setScript(e.target.value as FontScript | "any")}
          className="border-input h-7 rounded-[5px] border-[1.5px] bg-transparent px-1.5 text-[12.5px]"
        >
          <option value="any">Any script</option>
          {(Object.keys(SCRIPT_LABEL) as FontScript[]).map((s) => (
            <option key={s} value={s}>
              {SCRIPT_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      {needed.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Showing fonts that can write {needed.map((s) => SCRIPT_LABEL[s]).join(" and ")},
          for this form&apos;s languages.
        </p>
      )}
      <ul
        className="border-input max-h-[240px] overflow-y-auto rounded-sm border-[1.5px]"
        aria-label="Fonts"
      >
        {matches.slice(0, SHOWN).map((f) => (
          <li key={f.family}>
            <button
              type="button"
              onClick={() => pick(f.family)}
              aria-pressed={f.family === value}
              className="fc-focus hover:bg-muted flex w-full items-center justify-between px-3 py-1.5 text-left text-[13.5px]"
            >
              <span>
                {f.family}
                {brand.includes(f.family) && (
                  <span className="text-muted-foreground ml-1.5 text-[11px]">Brand</span>
                )}
                {!brand.includes(f.family) && recent.includes(f.family) && !query && (
                  <span className="text-muted-foreground ml-1.5 text-[11px]">Recent</span>
                )}
              </span>
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
