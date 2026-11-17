"use client";

import { createContext, useContext } from "react";

/**
 * The names of files uploaded in this visit, by upload id, so the review
 * before submitting (F-60) can list them. Only names the browser chose
 * itself are known; after a refresh the answer is just an id, and the
 * review says "File uploaded".
 */
export const UploadNamesContext = createContext<Map<string, string> | null>(null);

export function useUploadNames(): Map<string, string> | null {
  return useContext(UploadNamesContext);
}
