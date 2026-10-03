// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Two-factor authentication is enforced by a restrictive policy on every
 * table (migration 37 added it to the tables that existed). A table
 * created later must add it itself — this fails if one forgets, which
 * would leave that table readable with a password-only session.
 */
describe("2FA policy coverage", () => {
  it("every table created after migration 37 has the second-factor policy", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const later = readdirSync(dir)
      .filter((f) => f.endsWith(".sql") && Number(f.slice(0, 14)) > 37)
      .sort();
    const sql = later.map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    const tables = [
      ...sql.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/g),
    ].map((m) => m[1]);
    const guarded = new Set(
      [
        ...sql.matchAll(
          /create policy "mfa: second factor when enrolled" on public\.([a-z_]+) as restrictive/g,
        ),
      ].map((m) => m[1]),
    );
    expect(tables.filter((t) => !guarded.has(t))).toEqual([]);
    // The check is looking at real tables, not passing on an empty list.
    expect(tables).toContain("response_insights");
  });
});
