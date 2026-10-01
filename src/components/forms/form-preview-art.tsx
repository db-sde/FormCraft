import type { FormPreview } from "@/domains/forms";
import { contrastRatio } from "@/domains/themes";
import { THEME_BUTTON_RADIUS, THEME_FONT_STACK } from "@/components/theme-styles";
import { cn } from "cn";

/** Readable text for a given background when the theme doesn't set one. */
function inkFor(background: string): string {
  try {
    return contrastRatio(background, "#1f1f1f") >= contrastRatio(background, "#ffffff")
      ? "#1f1f1f"
      : "#ffffff";
  } catch {
    return "#1f1f1f";
  }
}

/**
 * The top of a form or template card: the form's first question drawn
 * in its own theme — background, font, button shape, primary colour —
 * so creators recognise a form at a glance (Part 1 §3 "Form card").
 */
export function FormPreviewArt({
  preview,
  className,
  progress = true,
  compact = false,
}: {
  preview: FormPreview;
  className?: string;
  /** The thin progress bar at the top (dashboard cards have it). */
  progress?: boolean;
  /** Small thumbnail (list rows, phone cards): just colours and a button. */
  compact?: boolean;
}) {
  const { theme } = preview;
  const text = theme.textColor ?? inkFor(theme.backgroundColor);
  const onPrimary = inkFor(theme.primaryColor);
  const radius = THEME_BUTTON_RADIUS[theme.buttonStyle];
  const font = THEME_FONT_STACK[theme.fontFamily];
  const line = `color-mix(in oklab, ${text} 22%, ${theme.backgroundColor})`;
  const chip = `color-mix(in oklab, ${theme.backgroundColor} 60%, #fff)`;

  if (compact) {
    return (
      <span
        aria-hidden
        className={cn("grid place-items-center", className)}
        style={{ background: theme.backgroundColor }}
      >
        <span
          className="block h-2 w-[22px]"
          style={{ background: theme.primaryColor, borderRadius: radius }}
        />
      </span>
    );
  }

  return (
    <div
      aria-hidden
      className={cn(
        "flex flex-col justify-center gap-[9px] px-[22px] py-[18px]",
        className,
      )}
      style={{ background: theme.backgroundColor, fontFamily: font, color: text }}
    >
      {progress && (
        <div className="h-[3px] w-2/5 rounded-[2px]" style={{ background: line }}>
          <div
            className="h-full w-[55%] rounded-[2px]"
            style={{ background: theme.primaryColor }}
          />
        </div>
      )}
      <div className="truncate text-[14px] leading-[1.25] font-semibold">
        {preview.question}
      </div>
      {preview.chips.length > 0 && (
        <div className="flex gap-1.5 overflow-hidden">
          {preview.chips.map((label, i) => (
            <span
              key={`${label}-${i}`}
              className="shrink-0 truncate border px-2.5 py-1 text-[11px] leading-[1.2] font-medium"
              style={{ borderColor: line, borderRadius: radius, background: chip }}
            >
              {label}
            </span>
          ))}
        </div>
      )}
      <div
        className="self-start px-3 py-[5px] text-[11px] leading-[1.2] font-semibold"
        style={{ background: theme.primaryColor, color: onPrimary, borderRadius: radius }}
      >
        OK
      </div>
    </div>
  );
}
