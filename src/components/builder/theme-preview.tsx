import type { ThemeV1 } from "@/domains/forms/schema/v1";
import { ThemedButton, ThemedSlide } from "./themed-slide";

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
    <div className="mx-auto w-full max-w-2xl">
      <div className="text-muted-foreground mb-3 text-xs font-medium">
        Design — colours, font and buttons for every screen of this form
      </div>
      <ThemedSlide theme={theme} className="items-center text-center">
        <h2 className="text-2xl font-semibold">{formTitle}</h2>
        <p className="opacity-70">This is how your form looks to respondents.</p>
        <ThemedButton theme={theme}>Start</ThemedButton>
      </ThemedSlide>
    </div>
  );
}
