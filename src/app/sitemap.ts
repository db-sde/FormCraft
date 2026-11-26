import type { MetadataRoute } from "next";
import { createAdminClient } from "@/lib/supabase/admin";

/** Refreshed hourly: forms join when their indexing is turned on and
 * published, and leave when it's turned off, archived or closed. */
export const revalidate = 3600;

const PAGES = [
  "/",
  "/pricing",
  "/developers",
  "/security",
  "/legal/subprocessors",
  "/signup",
  "/login",
];

/**
 * sitemap.xml (QA FC4-30): the public pages, and the forms whose creators
 * let search engines list them (developer spec item 1; Starter and up).
 * A form on a custom domain has its canonical address there, so it isn't
 * listed under this host.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const pages: MetadataRoute.Sitemap = PAGES.map((path) => ({
    url: `${base}${path === "/" ? "" : path}` || "/",
    changeFrequency: "monthly",
  }));
  try {
    const { data } = await createAdminClient().rpc("sitemap_forms");
    for (const f of data ?? []) {
      if (f.hostname) continue;
      pages.push({
        url: `${base}/f/${f.slug}`,
        lastModified: f.updated_at,
        changeFrequency: "weekly",
      });
    }
  } catch {
    // The pages above are enough if the database can't be reached.
  }
  return pages;
}
