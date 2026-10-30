import { z } from "zod";

/** The import report (F-05), shared by the server and the builder. */

export const IMPORT_SOURCES = ["google_forms", "typeform"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export const IMPORT_SOURCE_LABEL: Record<ImportSource, string> = {
  google_forms: "Google Forms",
  typeform: "Typeform",
};

export type FieldStatus = "imported" | "converted" | "unknown";

export const ImportReport = z.object({
  source: z.enum(IMPORT_SOURCES),
  sourceUrl: z.string(),
  importedAt: z.string(),
  fields: z.array(
    z.object({
      label: z.string(),
      status: z.enum(["imported", "converted", "unknown"]),
      note: z.string().optional(),
    }),
  ),
  logic: z.object({ imported: z.number().int(), notes: z.array(z.string()) }),
  notes: z.array(z.string()),
});
export type ImportReport = z.infer<typeof ImportReport>;
