"use client";

import { createContext, useContext } from "react";
import { uiStrings, type UiStrings } from "@/domains/forms/i18n";

/** FormCraft's own words on the respondent form, in the respondent's
 * language (P2.21). English unless a FormRuntime says otherwise. */
export const RuntimeStringsContext = createContext<UiStrings>(uiStrings("en"));

export function useRuntimeStrings(): UiStrings {
  return useContext(RuntimeStringsContext);
}
