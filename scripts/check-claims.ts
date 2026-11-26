/**
 * Fails when the site, the app or an email template makes a SOC 2 claim
 * that isn't the approved wording (developer spec item 6). Also fails on
 * any SOC logo or badge file in the site's assets.
 *
 *   npm run check:claims
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { bannedClaimsIn } from "../src/domains/marketing/claims";

const ROOTS = ["src", "public", "supabase/templates", "supabase/migrations"];
const TEXT = /\.(ts|tsx|js|mjs|css|html|md|mdx|json|sql|txt)$/;
const SKIP = new Set(["src/domains/marketing/claims.ts"]);

function* files(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

const problems: string[] = [];
for (const root of ROOTS) {
  for (const path of files(root)) {
    if (/soc[-_ ]?2|aicpa/i.test(path.split("/").pop() ?? "") && !TEXT.test(path)) {
      problems.push(`${path}: SOC logos and badges aren't allowed`);
      continue;
    }
    if (!TEXT.test(path) || SKIP.has(path) || /\.test\.tsx?$/.test(path)) continue;
    for (const hit of bannedClaimsIn(readFileSync(path, "utf8"))) {
      problems.push(`${path}:${hit.line}: ${hit.text}`);
    }
  }
}

if (problems.length) {
  console.error(
    "SOC 2 claims must use the approved wording (src/domains/marketing/claims.ts):",
  );
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("SOC 2 wording check passed.");
