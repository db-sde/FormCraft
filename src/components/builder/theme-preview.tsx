import type { ThemeV1 } from "@/domains/forms/schema/v1";
import { THEME_FONT_STACK, THEME_BUTTON_RADIUS } from "@/components/theme-styles";

/** Renders a small mock "welcome screen" styled with the current
 * theme, so the creator sees a live effect of every change without
 * needing the full public runtime. */
export function ThemePreview({
  theme,
  formTitle,
}: {
  theme: ThemeV1;
  formTitle: string;
}) {
  return (
    <div
      className="mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-lg border p-10 text-center shadow-sm"
      style={{
        backgroundColor: theme.backgroundColor,
        color: theme.textColor ?? undefined,
        fontFamily: THEME_FONT_STACK[theme.fontFamily],
        backgroundImage: theme.backgroundImageUrl
          ? `url(${theme.backgroundImageUrl})`
          : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {theme.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- external, variable-origin Supabase Storage URL
        <img src={theme.logoUrl} alt="" className="h-10 object-contain" />
      )}
      <h2 className="text-xl font-semibold">{formTitle}</h2>
      <p className="text-sm opacity-70">This is what your theme looks like.</p>
      <button
        type="button"
        disabled
        className="pointer-events-none px-5 py-2 text-sm font-medium text-white"
        style={{
          backgroundColor: theme.primaryColor,
          borderRadius: THEME_BUTTON_RADIUS[theme.buttonStyle],
        }}
      >
        Start
      </button>
    </div>
  );
}
