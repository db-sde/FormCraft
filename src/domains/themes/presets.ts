import type { ThemeV1 } from "@/domains/forms/schema/v1";

export type ThemePreset = { id: string; name: string; theme: Omit<ThemeV1, "preset"> };

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "classic",
    name: "Classic",
    theme: {
      primaryColor: "#0f172a",
      backgroundColor: "#ffffff",
      textColor: "#0f172a",
      fontFamily: "inter",
      buttonStyle: "rounded",
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    theme: {
      primaryColor: "#0369a1",
      backgroundColor: "#f0f9ff",
      textColor: "#0c4a6e",
      fontFamily: "inter",
      buttonStyle: "pill",
    },
  },
  {
    id: "forest",
    name: "Forest",
    theme: {
      primaryColor: "#166534",
      backgroundColor: "#f0fdf4",
      textColor: "#14532d",
      fontFamily: "system",
      buttonStyle: "rounded",
    },
  },
  {
    id: "sunset",
    name: "Sunset",
    theme: {
      primaryColor: "#c2410c",
      backgroundColor: "#fff7ed",
      textColor: "#7c2d12",
      fontFamily: "georgia",
      buttonStyle: "pill",
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    theme: {
      primaryColor: "#818cf8",
      backgroundColor: "#0f172a",
      textColor: "#e2e8f0",
      fontFamily: "mono",
      buttonStyle: "square",
    },
  },
  {
    id: "mono",
    name: "Monochrome",
    theme: {
      primaryColor: "#171717",
      backgroundColor: "#fafafa",
      textColor: "#171717",
      fontFamily: "mono",
      buttonStyle: "square",
    },
  },
];
