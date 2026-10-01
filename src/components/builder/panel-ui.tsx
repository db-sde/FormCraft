"use client";

import { useId } from "react";
import { CircleAlert, Info } from "lucide-react";
import { cn } from "cn";
import { Switch } from "@/components/ui/switch";

/** Shared pieces of the builder's right-hand panel (Part 4). */

export function PanelHeader({
  tile,
  title,
  subtitle,
}: {
  tile: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {tile}
      <div className="flex flex-col leading-tight">
        <b className="font-heading text-base">{title}</b>
        {subtitle && (
          <span className="text-muted-foreground text-[12.5px]">{subtitle}</span>
        )}
      </div>
    </div>
  );
}

/** The red "Not saved." banner shown for the selected item's invalid setting. */
export function NotSavedAlert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex gap-2.5 rounded-sm border-[1.5px] border-[var(--alert-error-border)] bg-[var(--alert-error-bg)] px-3 py-[11px] text-[13.5px] leading-[1.45] text-[var(--alert-error-fg)]"
    >
      <CircleAlert className="mt-px size-[17px] shrink-0" />
      <span>
        <b>Not saved.</b> {children}
      </span>
    </div>
  );
}

/** Caps label with a quiet rule above — groups the fields below it. */
export function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-border text-muted-foreground col-span-full border-t-[1.5px] pt-2 text-[11.5px] font-bold tracking-[0.1em] uppercase">
      {children}
    </div>
  );
}

/** A labelled control. `half` puts two side by side. */
export function PanelField({
  label,
  hint,
  half,
  htmlFor,
  children,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  half?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5",
        half ? "" : "col-span-full",
        className,
      )}
    >
      <label htmlFor={htmlFor} className="text-[13.5px] font-semibold">
        {label}
      </label>
      {children}
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </div>
  );
}

/** Compact 38px input/select used inside the panel. */
export const PANEL_INPUT = "h-[38px] px-2.5 text-sm";

/** A switch on a muted row with a title and an optional hint. */
export function SwitchRow({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="bg-background col-span-full flex items-center justify-between gap-3 rounded-sm px-3 py-2.5">
      <label htmlFor={id} className="flex cursor-pointer flex-col gap-0.5">
        <b className="text-sm">{label}</b>
        {hint && <span className="text-muted-foreground text-[12.5px]">{hint}</span>}
      </label>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}

/** A segmented control (e.g. Rating scale 5 / 10, Button style). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="col-span-full flex flex-col gap-1.5">
      <span className="text-[13.5px] font-semibold">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="border-input bg-background flex gap-0.5 rounded-[8px] border-[1.5px] p-[3px]"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "fc-focus h-[30px] flex-1 rounded-[5px] text-[13px] font-semibold",
              value === o.value
                ? "bg-secondary text-secondary-foreground"
                : "text-foreground hover:bg-hover-wash",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Toggleable pill chips (e.g. accepted file types). */
export function ChipToggles({
  label,
  options,
}: {
  label: string;
  options: { label: string; on: boolean; onToggle: () => void }[];
}) {
  return (
    <div className="col-span-full flex flex-col gap-1.5">
      <span className="text-[13.5px] font-semibold">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            aria-pressed={o.on}
            onClick={o.onToggle}
            className={cn(
              "fc-focus flex h-[30px] items-center gap-1.5 rounded-full border-[1.5px] px-2.5 text-[13px] font-semibold",
              o.on ? "border-ink bg-accent" : "border-input bg-card",
            )}
          >
            {o.on && "✓ "}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A blue info note. */
export function PanelNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-full flex gap-2.5 rounded-sm bg-[var(--alert-info-bg)] px-3 py-2.5 text-[13px] leading-[1.45] text-[var(--alert-info-fg)]">
      <Info className="size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
