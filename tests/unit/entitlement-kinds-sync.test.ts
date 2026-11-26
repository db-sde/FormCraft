import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENTITLEMENT_DEFAULTS } from "@/domains/billing/entitlements";
import { MINIMUM_PLAN_HINT } from "@/domains/billing/entitlements";
import {
  PLAN_ENTITLEMENTS,
  upgradeHint,
  PLAN_PRICES,
  PUBLIC_PLAN_IDS,
} from "@/domains/billing/catalog";

/**
 * The database validates plan and override changes against its own list
 * of entitlement keys (private.entitlement_kinds), and seeds the plans
 * (migration 77). Both must match the code: a key the code knows but the
 * database refuses (or the reverse) would make an approved change fail or
 * do nothing, and a seed that drifted from catalog.ts would sell one thing
 * and enforce another.
 */
const dir = join(process.cwd(), "supabase/migrations");
const migrations = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(dir, f), "utf8"));

/** The latest definition of private.entitlement_kinds(). */
function latestKinds(): Record<string, string> {
  const withKinds = migrations.filter((s) =>
    /function private\.entitlement_kinds\(\)/.test(s),
  );
  const sql = withKinds[withKinds.length - 1];
  const block = sql.slice(sql.indexOf("private.entitlement_kinds()"));
  return Object.fromEntries(
    [
      ...block
        .slice(0, block.indexOf(") e(key, kind)"))
        .matchAll(/\('([a-z_]+)', '(feature|limit)'\)/g),
    ].map((m) => [m[1], m[2]]),
  );
}

describe("entitlement keys: database and code agree", () => {
  it("has the same keys, each a feature (true/false) or a limit (number/unlimited)", () => {
    const fromCode = Object.entries(ENTITLEMENT_DEFAULTS).map(([key, value]) => [
      key,
      typeof value === "boolean" ? "feature" : "limit",
    ]);
    expect(latestKinds()).toEqual(Object.fromEntries(fromCode));
  });

  it("seeds every plan exactly as catalog.ts defines it", () => {
    const seed = migrations.find((s) =>
      s.includes(
        "insert into public.plans (id, name, sort_order, entitlements, monthly_usd",
      ),
    )!;
    for (const [id, entitlements] of Object.entries(PLAN_ENTITLEMENTS)) {
      const row = seed.match(
        new RegExp(
          `\\('${id}', '[^']+', \\d+, '(\\{[^']+\\})'::jsonb, ([\\d.]+|null), ([\\d.]+|null)`,
        ),
      );
      expect(row, id).not.toBeNull();
      expect(JSON.parse(row![1]), id).toEqual(entitlements);
      if ((PUBLIC_PLAN_IDS as readonly string[]).includes(id)) {
        const price = PLAN_PRICES[id as keyof typeof PLAN_PRICES];
        expect([Number(row![2]), Number(row![3])], id).toEqual([
          price.monthly,
          price.annual,
        ]);
      }
    }
  });

  it("gives every plan at least what the plan below it has", () => {
    const order = [...PUBLIC_PLAN_IDS];
    for (let i = 1; i < order.length; i += 1) {
      const lower = PLAN_ENTITLEMENTS[order[i - 1]];
      const higher = PLAN_ENTITLEMENTS[order[i]];
      for (const [key, value] of Object.entries(lower)) {
        const next = higher[key as keyof typeof higher];
        if (typeof value === "boolean") {
          if (value) expect(next, `${order[i]}.${key}`).toBe(true);
        } else if (value === null) {
          expect(next, `${order[i]}.${key}`).toBeNull();
        } else if (next !== null) {
          expect(next as number, `${order[i]}.${key}`).toBeGreaterThanOrEqual(value);
        }
      }
    }
  });

  it("tells people the right plan for every feature", () => {
    for (const [feature, hint] of Object.entries(MINIMUM_PLAN_HINT)) {
      const onFree = PLAN_ENTITLEMENTS.free[feature as keyof typeof MINIMUM_PLAN_HINT];
      expect(hint, feature).toBe(onFree ? "" : upgradeHint(feature as never));
    }
  });
});
