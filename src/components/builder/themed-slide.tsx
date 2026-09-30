import type { ThemeV1 } from "@/domains/forms/schema/v1";
import { themeButtonStyle, themeSurfaceStyle } from "@/components/theme-styles";
import { cn } from "cn";

/**
 * The builder's canvas: one screen of the form rendered in the form's
 * own theme, so what the creator edits is what respondents see. Inputs
 * inside are previews (disabled) but keep full contrast.
 */
export function ThemedSlide({
  theme,
  children,
  className,
}: {
  theme: ThemeV1;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[380px] flex-col justify-center gap-4 rounded-2xl border px-6 py-10 shadow-sm sm:px-14 sm:py-14",
        "[&_:disabled]:cursor-default [&_:disabled]:opacity-100",
        className,
      )}
      style={themeSurfaceStyle(theme) as React.CSSProperties}
    >
      {theme.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL
        <img src={theme.logoUrl} alt="" className="mb-2 h-8 self-start object-contain" />
      )}
      {children}
    </div>
  );
}

/** A non-interactive button in the form's button style. */
export function ThemedButton({
  theme,
  children,
}: {
  theme: ThemeV1;
  children: React.ReactNode;
}) {
  return (
    <span
      aria-hidden
      className="inline-flex h-10 items-center self-start px-5 text-sm font-medium shadow-sm"
      style={themeButtonStyle(theme)}
    >
      {children}
    </span>
  );
}
