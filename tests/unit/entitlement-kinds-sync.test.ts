import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENTITLEMENT_DEFAULTS } from "@/domains/billing/entitlements";

/**
 * The database validates plan and override changes against its own list
 * of entitlement keys (private.entitlement_kinds, migration 71). It must
 * match the code's: a key the code knows but the database refuses (or the
 * reverse) would make an approved change fail or do nothing.
 */
describe("entitlement keys: database and code agree", () => {
  it("has the same keys, each a feature (true/false) or a limit (number/unlimited)", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/00000000000071_customer_operations.sql"),
      "utf8",
    );
    const block = sql.slice(sql.indexOf("private.entitlement_kinds()"));
    const pairs = [
      ...block
        .slice(0, block.indexOf(") e(key, kind)"))
        .matchAll(/\('([a-z_]+)', '(feature|limit)'\)/g),
    ].map((m) => [m[1], m[2]]);
    const fromCode = Object.entries(ENTITLEMENT_DEFAULTS).map(([key, value]) => [
      key,
      typeof value === "boolean" ? "feature" : "limit",
    ]);
    expect(Object.fromEntries(pairs)).toEqual(Object.fromEntries(fromCode));
  });
});
