"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Light / Dark / System for the creator app (Account settings). Follows
 * the OS by default. Respondent forms ignore it — they always render in
 * the creator's own theme (see src/app/f/[slug]).
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
