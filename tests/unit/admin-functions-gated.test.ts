import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Super Admin (docs/super-admin-design.md §3.4): every `admin_*` database
 * function callable by signed-in users must ask private.check_staff()
 * first. Two exceptions are callable only with the secret key.
 */
const SERVICE_ROLE_ONLY = new Set(["admin_verify_audit_chain", "admin_bootstrap_owner"]);
const dir = join(process.cwd(), "supabase/migrations");
const sql = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(dir, f), "utf8"))
  .join("\n");

/** Each admin_* function's latest definition (a later migration wins). */
function adminFunctions(): Map<string, string> {
  const found = new Map<string, string>();
  const re =
    /create (?:or replace )?function public\.(admin_\w+)\s*\(([\s\S]*?)\$\$([\s\S]*?)\$\$;/g;
  for (const m of sql.matchAll(re)) found.set(m[1], m[3]);
  return found;
}

describe("admin_* functions are gated", () => {
  const functions = adminFunctions();

  it("finds them", () => {
    expect(functions.size).toBeGreaterThanOrEqual(10);
  });

  it("each one asks check_staff before doing anything", () => {
    const ungated = [...functions]
      .filter(([name]) => !SERVICE_ROLE_ONLY.has(name))
      .filter(([, body]) => !/private\.check_staff\(/.test(body))
      .map(([name]) => name);
    expect(ungated).toEqual([]);
  });

  it("the secret-key-only ones are granted to service_role alone", () => {
    for (const name of SERVICE_ROLE_ONLY) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`,
        ),
      );
    }
  });

  it("nothing in the private schema is granted to API roles", () => {
    expect(sql).not.toMatch(
      /grant [^;]* on (?:table )?private\.[^;]* to (?:anon|authenticated)/i,
    );
  });
});
