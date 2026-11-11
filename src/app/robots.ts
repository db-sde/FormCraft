import type { MetadataRoute } from "next";

/** robots.txt (QA FC4-30): the marketing and sign-in pages may be
 * indexed; signed-in areas, the API and invitation links may not.
 * Published forms decide for themselves (their own robots meta). */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/dashboard",
        "/forms",
        "/leads",
        "/templates",
        "/settings",
        "/bookings",
        "/blocks",
        "/invite/",
        "/auth/",
        "/booking/",
      ],
    },
    ...(base ? { sitemap: `${base}/sitemap.xml` } : {}),
  };
}
