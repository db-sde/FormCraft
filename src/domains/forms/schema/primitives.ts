import { z } from "zod";

/** Stable ids (questions, options, endings, rules, variables) are
 * generated client-side with nanoid and never derived from position. */
export const stableId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "id must be URL-safe (letters, numbers, - or _)");

// Reject NUL bytes anywhere in user-supplied free text — Postgres text
// columns/JSONB cannot store them and some clients mishandle them.
export const safeText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => !v.includes("\u0000"), "text must not contain NUL characters");

export const optionalSafeText = (max: number) => safeText(max).optional();
