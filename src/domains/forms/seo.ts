import { z } from "zod";

/**
 * Link preview and SEO (pricing doc, Starter and up): what a shared link
 * shows (title, description, image), the browser tab's icon, and whether
 * search engines may index the form. Free forms get the automatic preview
 * from the form's own title and description. Images must be the
 * workspace's own uploads (this app's theme-assets bucket), never another
 * site's, so the page's security policy stays as it is.
 */
export const FormSeo = z.object({
  title: z.string().trim().max(70).optional(),
  description: z.string().trim().max(200).optional(),
  imageUrl: z.string().url().max(500).optional(),
  faviconUrl: z.string().url().max(500).optional(),
  /** False asks search engines not to index the form. */
  indexing: z.boolean().optional(),
});
export type FormSeo = z.infer<typeof FormSeo>;

export function readSeo(value: unknown): FormSeo {
  const parsed = FormSeo.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

/** Whether a URL is one of this workspace's uploads. */
export function isOwnUpload(url: string, workspaceId: string): boolean {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  return (
    base !== "" &&
    url.startsWith(`${base}/storage/v1/object/public/theme-assets/${workspaceId}/`)
  );
}
