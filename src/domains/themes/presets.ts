import type { ThemeV1 } from "@/domains/forms/schema/v1";

export type ThemePreset = { id: string; name: string; theme: Omit<ThemeV1, "preset"> };

/** The theme presets from the design system (Part 6 §2). Picking one
 * copies its values into the form's theme; the creator can still change
 * any of them afterwards. */
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "classic",
    name: "Classic",
    theme: {
      primaryColor: "#1f1f1f",
      backgroundColor: "#ffffff",
      textColor: "#1f1f1f",
      fontFamily: "inter",
      buttonStyle: "rounded",
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    theme: {
      primaryColor: "#1d6f8c",
      backgroundColor: "#e4eff4",
      textColor: "#0f2f3b",
      fontFamily: "system",
      buttonStyle: "pill",
    },
  },
  {
    id: "forest",
    name: "Forest",
    theme: {
      primaryColor: "#3f6b3b",
      backgroundColor: "#ecf0e2",
      textColor: "#1d2a1b",
      fontFamily: "georgia",
      buttonStyle: "square",
    },
  },
  {
    id: "sunset",
    name: "Sunset",
    theme: {
      primaryColor: "#e05d36",
      backgroundColor: "#ffeee2",
      textColor: "#3a1c11",
      fontFamily: "inter",
      buttonStyle: "pill",
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    theme: {
      primaryColor: "#b8a3ff",
      backgroundColor: "#16131f",
      textColor: "#f1edfb",
      fontFamily: "inter",
      buttonStyle: "rounded",
    },
  },
];
