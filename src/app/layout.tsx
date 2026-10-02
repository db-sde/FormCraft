import type { Metadata } from "next";
import {
  DM_Sans,
  DM_Serif_Display,
  Inter,
  JetBrains_Mono,
  Lora,
  Nunito,
  Playfair_Display,
  Poppins,
  Space_Grotesk,
} from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

// Self-hosted at build time by next/font (no request to Google at runtime).
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

// The "Inter" choice in a form's theme (respondent forms only).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Paid theme fonts (P2.22). Not preloaded: a font file is only fetched
// by a page that actually uses it.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  preload: false,
});
const lora = Lora({ variable: "--font-lora", subsets: ["latin"], preload: false });
const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  preload: false,
});
const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"], preload: false });
const dmSerif = DM_Serif_Display({
  variable: "--font-dm-serif",
  subsets: ["latin"],
  weight: "400",
  preload: false,
});

export const metadata: Metadata = {
  title: { default: "FormCraft", template: "%s · FormCraft" },
  description: "Build and publish forms, collect responses, and see the results.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${dmSans.variable} ${jetbrainsMono.variable} ${inter.variable} ${poppins.variable} ${lora.variable} ${playfair.variable} ${nunito.variable} ${dmSerif.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
