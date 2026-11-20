"use client";

import { createContext, useContext } from "react";

/** What this deployment has set up, for settings that need a service
 * (address suggestions need a Google Places key, QA FC11-01; email codes
 * need an email service, roadmap #8). */
export type BuilderCapabilities = {
  placesAvailable: boolean;
  emailCodesAvailable: boolean;
};

export const BuilderCapabilitiesContext = createContext<BuilderCapabilities>({
  placesAvailable: false,
  emailCodesAvailable: false,
});

export function useBuilderCapabilities(): BuilderCapabilities {
  return useContext(BuilderCapabilitiesContext);
}
