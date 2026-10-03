import { ArrowRight, ArrowUp, Check, TriangleAlert } from "lucide-react";
import type { ThemeV1 } from "@/domains/forms/schema/v1";
import { cn } from "cn";
import { stageVars } from "./stage-theme";
import { isAllowedFontUrl } from "@/domains/themes/fonts";

export type StageMode = "auto" | "desktop" | "phone" | "canvas";

/**
 * The respondent stage (Part 6 / "FC Stage"): one frame for every
 * question type and theme — used by the public form, the builder's
 * Preview and the builder canvas, so all three look identical. Colours
 * come from the creator's theme (stageVars); sizes from the mode.
 */
export function Stage({
  theme,
  mode = "auto",
  progress,
  banner,
  madeWith = false,
  className,
  contentClassName,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "style"> & {
  theme: ThemeV1;
  mode?: StageMode;
  /** 0–1; omit to hide the bar. */
  progress?: number;
  /** A pill at the top centre, e.g. "Welcome back". */
  banner?: React.ReactNode;
  /** The "Made with FormCraft" badge at the bottom (endings). */
  madeWith?: boolean;
  contentClassName?: string;
}) {
  return (
    <div
      {...props}
      data-mode={mode === "canvas" ? undefined : mode}
      className={cn("fc-stage relative flex flex-col overflow-hidden", className)}
      style={stageVars(theme)}
    >
      <CustomFontFace theme={theme} />
      {theme.backgroundImageUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- creator-uploaded Supabase Storage URL */}
          <img
            src={theme.backgroundImageUrl}
            alt=""
            className="pointer-events-none absolute inset-0 size-full object-cover"
          />
          {/* A 72% background-colour scrim keeps text readable over the photo. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background: `color-mix(in oklab, ${theme.backgroundColor} 72%, transparent)`,
            }}
          />
        </>
      )}
      {progress !== undefined && (
        <div
          role="progressbar"
          aria-label="Form progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="relative h-(--st-bar) shrink-0 bg-(--st-line)"
        >
          <div
            className="h-full rounded-r-full bg-(--st-primary) transition-[width] duration-400 ease-out"
            style={{ width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }}
          />
        </div>
      )}
      {theme.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- creator-uploaded Supabase Storage URL
        <img
          src={theme.logoUrl}
          alt=""
          className="absolute top-[22px] left-(--st-pad-x) z-[1] h-8 max-w-40 object-contain object-left"
        />
      )}
      {banner && (
        <div className="absolute top-[22px] left-1/2 z-[1] -translate-x-1/2">
          {banner}
        </div>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-auto p-(--st-pad)">
        <div
          className={cn(
            "m-auto flex w-full max-w-(--st-maxw) flex-col gap-(--st-gap)",
            contentClassName,
          )}
        >
          {children}
        </div>
      </div>
      {madeWith && <MadeWithBadge />}
    </div>
  );
}

/** "Made with FormCraft" — always FormCraft-branded, never themed. */
export function MadeWithBadge({ className }: { className?: string }) {
  return (
    <a
      href="/"
      target="_blank"
      rel="noopener"
      className={cn(
        "absolute bottom-[18px] left-1/2 z-[1] flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[#2b2118] px-3 py-1.5 font-sans text-xs font-semibold whitespace-nowrap text-[#fffaf1]",
        className,
      )}
    >
      <span aria-hidden className="size-2.5 -rotate-8 rounded-[2px] bg-[#f2b233]" />
      Made with FormCraft
    </a>
  );
}

/** The "Welcome back" pill shown when a respondent resumes. */
export function WelcomeBackBanner({
  text = "Welcome back. Picking up where you left off.",
}: {
  text?: string;
}) {
  return (
    <div
      role="status"
      className="flex [animation:fc-fade-out_400ms_4s_forwards] items-center gap-2 rounded-full border border-(--st-primary) bg-(--st-sel) px-3.5 py-[7px] text-[13px] font-semibold whitespace-nowrap"
    >
      <span aria-hidden className="size-[7px] rounded-full bg-(--st-primary)" />
      {text}
    </div>
  );
}

/** The uploaded font (P2.22), declared under a fixed internal name so
 * nothing the creator typed reaches the CSS, and only for a URL in our
 * own storage (anything else is skipped and the fallback font shows). */
function CustomFontFace({ theme }: { theme: ThemeV1 }) {
  const url = theme.customFont?.url;
  if (
    theme.fontFamily !== "custom" ||
    !url ||
    !isAllowedFontUrl(url, process.env.NEXT_PUBLIC_SUPABASE_URL)
  ) {
    return null;
  }
  return (
    <style>{`@font-face{font-family:"fc-custom";src:url("${url}") format("woff2");font-display:swap}`}</style>
  );
}

/** A short note above the form, e.g. why a resume link didn't open. */
export function NoticeBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="flex max-w-full items-center gap-2 rounded-full border border-(--st-primary) bg-(--st-sel) px-3.5 py-[7px] text-[13px] font-semibold"
    >
      <span aria-hidden className="size-[7px] shrink-0 rounded-full bg-(--st-primary)" />
      {children}
    </div>
  );
}

/** "3 →" above a question. */
export function StageNumber({ n }: { n: number }) {
  return (
    <div className="flex items-center gap-1.5 text-(length:--st-num) font-semibold text-(--st-primary)">
      {n}
      <ArrowRight aria-hidden className="size-3.5" />
    </div>
  );
}

export const stageLabelClass =
  "text-(length:--st-label) leading-[1.22] [font-weight:var(--st-label-weight)] tracking-[-0.01em] text-pretty";
export const stageTitleClass =
  "text-(length:--st-title) leading-[1.1] font-bold tracking-[-0.02em] text-balance";
export const stageDescClass =
  "text-(length:--st-desc) leading-normal text-(--st-muted) text-pretty";

/** The red pill used for every validation and submission error — a
 * fixed colour so it stays readable on any theme. */
export function StageError({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 self-start rounded-[6px] bg-[#c8372d] px-3 py-[7px] [font-family:system-ui,sans-serif] text-[13.5px] font-semibold text-white"
    >
      <TriangleAlert aria-hidden className="size-[15px] shrink-0" />
      {children}
    </div>
  );
}

/** The primary button in the theme's colour and shape. */
export function StageButton({
  className,
  children,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex h-(--st-btn-h) shrink-0 items-center justify-center gap-2 rounded-(--st-br) bg-(--st-primary) px-[22px] text-(length:--st-btn-font) font-semibold text-(--st-on-primary) transition-[filter] hover:brightness-95 disabled:cursor-progress",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Back · OK ✓ / Submit · "press Enter ↵". */
export function StageActions({
  showBack,
  onBack,
  onNext,
  label,
  submitting = false,
  showCheck = false,
  enterHint,
  disabled = false,
  inert = false,
  backLabel = "Back",
  busyLabel = "Submitting…",
}: {
  /** What the button says while `submitting`. */
  busyLabel?: string;
  backLabel?: string;
  showBack: boolean;
  onBack?: () => void;
  onNext?: () => void;
  label: string;
  submitting?: boolean;
  showCheck?: boolean;
  enterHint?: string | null;
  disabled?: boolean;
  /** Builder canvas: drawn, not clickable. */
  inert?: boolean;
}) {
  return (
    <div className="mt-1 flex items-center gap-3 in-data-[mode=phone]:mt-1.5">
      {showBack && (
        <button
          type="button"
          aria-label={backLabel}
          onClick={onBack}
          disabled={submitting || disabled}
          tabIndex={inert ? -1 : undefined}
          className="grid size-(--st-btn-h) shrink-0 place-items-center rounded-(--st-br) border-[1.5px] border-(--st-line) disabled:opacity-50"
        >
          <ArrowUp className="size-[18px]" />
        </button>
      )}
      <StageButton
        onClick={onNext}
        disabled={submitting || disabled}
        aria-busy={submitting || undefined}
        tabIndex={inert ? -1 : undefined}
        className={cn(
          "in-data-[mode=phone]:flex-1",
          // The public form is phone-sized below 768px.
          "max-md:in-data-[mode=auto]:flex-1",
          submitting && "bg-[color-mix(in_oklab,var(--st-primary)_75%,var(--st-bg))]",
        )}
      >
        {submitting && (
          <span className="size-[15px] animate-spin rounded-full border-2 border-current border-t-transparent" />
        )}
        {submitting ? busyLabel : label}
        {showCheck && !submitting && <Check aria-hidden className="size-4" />}
      </StageButton>
      {enterHint && !submitting && (
        <span className="text-[12.5px] text-(--st-muted) in-data-[mode=phone]:hidden max-md:in-data-[mode=auto]:hidden [@media(hover:none)]:hidden">
          {enterHint}
        </span>
      )}
    </div>
  );
}
