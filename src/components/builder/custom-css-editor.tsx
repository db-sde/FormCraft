"use client";

import { useState } from "react";
import { customCssProblems, MAX_CUSTOM_CSS_LENGTH } from "@/domains/themes/custom-css";
import { cn } from "cn";

/** Class names the form's elements carry for custom CSS (F-14). */
const HOOKS: [string, string][] = [
  [".fc-stage", "the form's frame and background"],
  [".fc-question", "one question (a page's worth in the classic layout)"],
  [".fc-question-label", "a question's text"],
  [".fc-question-description", "the line under it"],
  [".fc-input", "text, number, date and select fields"],
  [".fc-choice", "a choice tile or picture card"],
  [".fc-picture", "a picture choice's image"],
  [".fc-button", "OK / Next / Submit"],
  [".fc-error", "an error message"],
  [".fc-progress", "the progress bar"],
  [".fc-page-title", "a page's title (classic layout)"],
  [".fc-ending", "the ending screen"],
];

/**
 * The Design panel's custom CSS (F-14). Problems show as they're typed:
 * errors stop the draft saving (the server checks the same rules), the
 * rest are things the browser will skip. Preview and the live form use
 * it; the builder's own canvas doesn't, so a stray rule can never make the
 * form uneditable — and Reset clears it.
 */
export function CustomCssEditor({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (css: string | undefined) => void;
}) {
  const [showHooks, setShowHooks] = useState(false);
  const css = value ?? "";
  const problems = css.trim() ? customCssProblems(css) : [];
  const errors = problems.filter((p) => p.severity === "error");

  return (
    <div className="col-span-full flex flex-col gap-2">
      <label htmlFor="custom-css" className="text-[13.5px] font-semibold">
        Custom CSS
      </label>
      <textarea
        id="custom-css"
        value={css}
        spellCheck={false}
        maxLength={MAX_CUSTOM_CSS_LENGTH + 1000}
        placeholder={".fc-question-label {\n  letter-spacing: 0.02em;\n}"}
        aria-invalid={errors.length > 0 || undefined}
        aria-describedby="custom-css-help"
        onChange={(e) => onChange(e.target.value.trim() ? e.target.value : undefined)}
        className={cn(
          "border-input bg-field min-h-36 w-full rounded-sm border-[1.5px] p-2.5 font-mono text-[12.5px] leading-relaxed outline-none focus:shadow-[var(--shadow-focus)]",
          errors.length > 0 && "border-destructive",
        )}
      />
      {problems.length > 0 && (
        <ul className="flex flex-col gap-1 text-[12.5px]" aria-live="polite">
          {problems.map((p) => (
            <li
              key={p.message}
              className={
                p.severity === "error"
                  ? "text-destructive font-semibold"
                  : "text-muted-foreground"
              }
            >
              {p.severity === "error" ? "Not saved: " : "Note: "}
              {p.message}
            </li>
          ))}
        </ul>
      )}
      <p
        id="custom-css-help"
        className="text-muted-foreground text-[12px] leading-normal"
      >
        Styles only this form, in Preview and on the live form once published. Media
        queries work for phones. Images in <code className="font-mono">url()</code> load
        only from this site and your uploads.
      </p>
      <div className="flex flex-wrap gap-3 text-[12.5px] font-semibold">
        <button
          type="button"
          onClick={() => setShowHooks((v) => !v)}
          aria-expanded={showHooks}
          className="fc-focus underline underline-offset-2"
        >
          {showHooks ? "Hide class names" : "Class names you can style"}
        </button>
        {css && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="fc-focus text-destructive underline underline-offset-2"
          >
            Reset custom CSS
          </button>
        )}
      </div>
      {showHooks && (
        <dl className="bg-background grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-sm p-2.5 text-[12px]">
          {HOOKS.map(([name, what]) => (
            <div key={name} className="contents">
              <dt className="font-mono">{name}</dt>
              <dd className="text-muted-foreground">{what}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
