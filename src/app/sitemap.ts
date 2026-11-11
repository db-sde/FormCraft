import type { MetadataRoute } from "next";

/** sitemap.xml (QA FC4-30): the public pages. Forms aren't listed:
 * they're shared by their own links, not meant to be found by search. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return ["/", "/signup", "/login"].map((path) => ({
    url: `${base}${path === "/" ? "" : path}` || "/",
    changeFrequency: "monthly",
  }));
}
