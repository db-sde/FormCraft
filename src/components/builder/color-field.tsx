"use client";

import { useId } from "react";
import { cn } from "cn";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** A swatch plus a mono hex field in one box (Part 4, Design panel).
 * `optional` lets the hex be cleared — e.g. Text, which is then worked
 * out from the background. */
export function ColorField({
  label,
  value,
  onChange,
  hint,
  optional = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  hint?: string;
  optional?: boolean;
  /** Shown when an optional value is empty. */
  placeholder?: string;
}) {
  const id = useId();
  const valid = HEX_RE.test(value) || (optional && value === "");

  return (
    <div className="col-span-full flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13.5px] font-semibold">
        {label}
      </label>
      <div
        className={cn(
          "bg-field focus-within:shadow-focus flex h-[38px] items-center gap-2 rounded-sm border-[1.5px] px-1.5",
          valid ? "border-input" : "border-destructive",
        )}
      >
        <input
          type="color"
          value={HEX_RE.test(value) ? value : (placeholder ?? "#000000")}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} swatch`}
          className="size-[26px] shrink-0 cursor-pointer rounded-[5px] border border-black/15 bg-transparent p-0 [&::-moz-color-swatch]:rounded-[4px] [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-[4px] [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
        />
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          aria-invalid={!valid}
          maxLength={7}
          spellCheck={false}
          placeholder={placeholder?.toUpperCase()}
          className="placeholder:text-subtle-foreground min-w-0 flex-1 bg-transparent font-mono text-[13px] uppercase outline-none"
        />
      </div>
      {!valid ? (
        <span className="text-destructive text-xs">
          Use a 6-digit hex colour, like #1D6F8C.
        </span>
      ) : (
        hint && <span className="text-muted-foreground text-xs">{hint}</span>
      )}
    </div>
  );
}
