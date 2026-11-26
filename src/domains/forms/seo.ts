import { z } from "zod";
import type { FormSchemaV1 } from "./schema/v1";

/**
 * Link preview and SEO (developer spec item 1; Starter and up): what a
 * shared link shows (title, description, image), the browser tab's icon,
 * and whether search engines may index the form (off unless turned on).
 * Free forms get the automatic preview: the form's title and a card made
 * at publish time with the FormCraft badge.
 *
 * `forms.seo` is the draft; publishing copies it to `forms.seo_live`.
 * Images must be this workspace's own uploads, never another site's.
 */
const noMergeTags = (v: string | undefined) => !v || !/\{\{|\}\}/.test(v);
const MERGE_TAG_MESSAGE = "Share fields can't use {{merge tags}}.";

export const FormSeo = z.object({
  title: z.string().trim().max(70).optional().refine(noMergeTags, MERGE_TAG_MESSAGE),
  description: z
    .string()
    .trim()
    .max(200)
    .optional()
    .refine(noMergeTags, MERGE_TAG_MESSAGE),
  imageUrl: z.string().url().max(500).optional(),
  faviconUrl: z.string().url().max(500).optional(),
  /** True lets search engines list the form; anything else is noindex. */
  indexing: z.boolean().optional(),
});
export type FormSeo = z.infer<typeof FormSeo>;

/** What the public page uses: the published settings and the share card
 * made at publish time. */
export type FormSeoLive = FormSeo & { cardUrl?: string };

export function readSeo(value: unknown): FormSeo {
  const parsed = FormSeo.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

export function readSeoLive(value: unknown): FormSeoLive {
  const seo = readSeo(value);
  const card = (value as { cardUrl?: unknown } | null)?.cardUrl;
  return typeof card === "string" && /^https:\/\/[^\s"'<>]+$/.test(card)
    ? { ...seo, cardUrl: card }
    : seo;
}

function storageBase(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
}

/** Whether a URL is one of this workspace's uploads: a share asset the
 * server re-encoded, or (older settings) a theme asset. */
export function isOwnUpload(url: string, workspaceId: string): boolean {
  const base = storageBase();
  return (
    base !== "" &&
    (url.startsWith(`${base}/storage/v1/object/public/share-assets/${workspaceId}/`) ||
      url.startsWith(`${base}/storage/v1/object/public/theme-assets/${workspaceId}/`))
  );
}

/** The share description when none is set: the welcome screen's first
 * line, else the form's description. */
export function defaultShareDescription(schema: FormSchemaV1): string | undefined {
  const welcome = schema.questions.find((q) => q.type === "welcome_screen");
  const first = welcome?.description
    ?.split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  return (first || schema.meta.description || undefined)?.slice(0, 200);
}
