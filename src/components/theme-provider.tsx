"use client";

import { usePathname } from "next/navigation";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Light / Dark / System for the creator app (Account settings). Follows
 * the OS by default. Respondent forms (/f/…) are always drawn in the
 * creator's own theme, so the app's dark mode is switched off there.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      forcedTheme={pathname?.startsWith("/f/") ? "light" : undefined}
    >
      {children}
    </NextThemesProvider>
  );
}
