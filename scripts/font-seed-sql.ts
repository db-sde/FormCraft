/**
 * Prints the SQL that seeds `font_families` from font-data.ts, for a
 * migration (developer spec item 3).
 *
 *   npx tsx scripts/font-seed-sql.ts
 */
import { libraryFonts } from "../src/domains/themes/font-library";

const rows = libraryFonts().map(
  (f) =>
    `  ('${f.family}', '${f.category}', '{${f.weights.join(",")}}', '{${f.scripts.join(",")}}', ${f.popularity})`,
);
console.log(`insert into public.font_families (family, category, weights, scripts, popularity)
values
${rows.join(",\n")}
on conflict (family) do update set
  category = excluded.category,
  weights = excluded.weights,
  scripts = excluded.scripts,
  popularity = excluded.popularity,
  refreshed_at = now();`);
