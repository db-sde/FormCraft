import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cheap static guards over supabase/migrations — the only source of
 * schema truth (CLAUDE.md). They can't replace the integration tests
 * against a real database, but they catch the mistakes that are easy to
 * make and easy to miss in review: a table with no row-level security,
 * a numbering clash between two branches, a definer function that can be
 * hijacked through search_path.
 */
const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const sql = files.map((f) => ({ file: f, text: readFileSync(join(dir, f), "utf8") }));
const all = sql.map((m) => m.text).join("\n");

describe("migrations", () => {
  it("are numbered 1, 2, 3… with no gaps or repeats", () => {
    const numbers = files.map((f) => {
      const match = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(f);
      expect(match, `${f} should look like 00000000000023_name.sql`).not.toBeNull();
      return Number(match![1]);
    });
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it("turn on row-level security for every table they create", () => {
    const created = [...all.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)];
    expect(created.length).toBeGreaterThan(0);
    for (const [, table] of created) {
      expect(
        new RegExp(`alter table public\\.${table} enable row level security`, "i").test(
          all,
        ),
        `public.${table} has no "enable row level security"`,
      ).toBe(true);
    }
  });

  it("never switch row-level security back off", () => {
    expect(all).not.toMatch(/disable row level security/i);
  });

  it("pin search_path on every security definer function", () => {
    const definitions = all.split(/(?=create (?:or replace )?function)/i).slice(1);
    const definers = definitions.filter((d) => {
      const header = d.slice(0, d.indexOf("$$") === -1 ? 800 : d.indexOf("$$"));
      return /security definer/i.test(header);
    });
    expect(definers.length).toBeGreaterThan(0);
    for (const definition of definers) {
      const header = definition.slice(0, definition.indexOf("$$"));
      const name = /function\s+([\w.]+)/i.exec(header)?.[1];
      expect(/set search_path/i.test(header), `${name} lacks "set search_path"`).toBe(
        true,
      );
    }
  });
});
