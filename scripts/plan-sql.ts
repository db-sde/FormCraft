/**
 * Prints the SQL that makes the database's plans and entitlement keys
 * match the code (catalog.ts, entitlements.ts), for a new migration.
 * tests/unit/entitlement-kinds-sync.test.ts checks the latest migration.
 *
 *   npx tsx scripts/plan-sql.ts
 */
import { ENTITLEMENT_DEFAULTS } from "../src/domains/billing/entitlements";
import {
  PLAN_ENTITLEMENTS,
  PLAN_NAMES,
  PLAN_PRICES,
  PLAN_PRICES_INR,
  PLAN_TAGLINES,
  PUBLIC_PLAN_IDS,
  type PlanId,
} from "../src/domains/billing/catalog";

const kinds = Object.entries(ENTITLEMENT_DEFAULTS).map(
  ([key, value]) => `('${key}', '${typeof value === "boolean" ? "feature" : "limit"}')`,
);
const lines: string[] = [];
for (let i = 0; i < kinds.length; i += 3)
  lines.push(`    ${kinds.slice(i, i + 3).join(", ")}`);

console.log(`create or replace function private.entitlement_kinds()
returns table (key text, kind text)
language sql
immutable
set search_path = ''
as $$
  select * from (values
${lines.join(",\n")}
  ) e(key, kind);
$$;
`);

const ids = Object.keys(PLAN_ENTITLEMENTS) as PlanId[];
const rows = ids.map((id, i) => {
  const pub = (PUBLIC_PLAN_IDS as readonly string[]).includes(id);
  const usd = pub ? PLAN_PRICES[id as keyof typeof PLAN_PRICES] : null;
  const inr = pub ? PLAN_PRICES_INR[id as keyof typeof PLAN_PRICES_INR] : null;
  const tagline = pub ? `'${PLAN_TAGLINES[id as keyof typeof PLAN_TAGLINES]}'` : "null";
  return `  ('${id}', '${PLAN_NAMES[id]}', ${i}, '${JSON.stringify(PLAN_ENTITLEMENTS[id])}'::jsonb, ${usd ? usd.monthly : "null"}, ${usd ? usd.annual : "null"}, ${inr ? inr.monthly : "null"}, ${inr ? inr.annual : "null"}, ${pub}, ${tagline})`;
});
console.log(`insert into public.plans (id, name, sort_order, entitlements, monthly_usd, annual_usd, monthly_inr, annual_inr, is_public, tagline)
values
${rows.join(",\n")}
on conflict (id) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  entitlements = excluded.entitlements,
  monthly_usd = excluded.monthly_usd,
  annual_usd = excluded.annual_usd,
  monthly_inr = excluded.monthly_inr,
  annual_inr = excluded.annual_inr,
  is_public = excluded.is_public,
  tagline = excluded.tagline;`);
