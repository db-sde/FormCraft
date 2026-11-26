import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { parseGoogleFontsMetadata, SAFE_FAMILY, type LibraryFont } from "./font-metadata";
import { findLibraryFont } from "./font-library";

type Client = SupabaseClient<Database>;

/**
 * The monthly font catalogue refresh (developer spec item 3), run by the
 * daily retention job: when the catalogue is over 30 days old, fetch
 * Google's public metadata and replace it. The database refuses an import
 * under 1,700 families.
 */
export async function refreshFontFamilies(
  admin: Client,
  fetcher: typeof fetch = fetch,
): Promise<{ refreshed: number } | { skipped: true }> {
  const { data: newest } = await admin
    .from("font_families")
    .select("refreshed_at")
    .order("refreshed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (newest && Date.now() - Date.parse(newest.refreshed_at) < 30 * 86_400_000) {
    return { skipped: true };
  }
  const res = await fetcher("https://fonts.google.com/metadata/fonts", {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Google Fonts metadata: HTTP ${res.status}`);
  const fonts = parseGoogleFontsMetadata(await res.text());
  const { data, error } = await admin.rpc("ops_replace_font_families", {
    p_fonts: fonts as unknown as Json,
  });
  if (error) throw error;
  return { refreshed: data ?? 0 };
}

const cache = new Map<string, { font: LibraryFont | null; until: number }>();

/** A library family by exact name: the built-in list first, then the
 * refreshed catalogue (cached for an hour). */
export async function findFontFamily(
  admin: Client,
  family: string | null,
): Promise<LibraryFont | null> {
  if (!family || !SAFE_FAMILY.test(family)) return null;
  const builtIn = findLibraryFont(family);
  if (builtIn) return builtIn;
  const hit = cache.get(family);
  if (hit && hit.until > Date.now()) return hit.font;
  const { data } = await admin
    .from("font_families")
    .select("family, category, weights, scripts, popularity")
    .eq("family", family)
    .maybeSingle();
  const font = data
    ? ({
        family: data.family,
        category: data.category,
        weights: data.weights,
        scripts: data.scripts,
        popularity: data.popularity,
      } as LibraryFont)
    : null;
  if (cache.size > 2000) cache.clear();
  cache.set(family, { font, until: Date.now() + 3_600_000 });
  return font;
}
