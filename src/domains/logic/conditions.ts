import type { Condition, Value } from "@/domains/forms/schema/logic-model";
import {
  asDate,
  asNumber,
  dayNumber,
  evaluateExpr,
  type ExprContext,
} from "./expressions";

const MAX_DEPTH = 16;

/** Empty in the sense respondents mean: nothing typed or chosen. */
export function isEmptyValue(v: Value): boolean {
  if (v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Strict equality on values (the legacy `equals` behaviour): same type
 * and content; lists compare as sets of their items. */
export function valuesEqual(a: Value, b: Value): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const set = new Set(a.map(String));
    return b.every((x) => set.has(String(x)));
  }
  return a === b;
}

function listOf(v: Value): (string | number)[] {
  if (v === null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "boolean") return [String(v)];
  return [v];
}

function includesItem(haystack: (string | number)[], needle: string | number): boolean {
  return haystack.some((x) => String(x) === String(needle));
}

/** Monday-based week index, for "this week". */
function weekIndex(isoDate: string): number {
  // 1970-01-01 was a Thursday; shift so weeks start on Monday.
  return Math.floor((dayNumber(isoDate) + 3) / 7);
}

function weekday(isoDate: string): number {
  // 0 = Sunday … 6 = Saturday
  return (((dayNumber(isoDate) + 4) % 7) + 7) % 7;
}

/** Orders two values: numbers numerically, dates by day; otherwise null
 * (not comparable — the comparison is then false). */
function order(a: Value, b: Value): number | null {
  const x = asNumber(a);
  const y = asNumber(b);
  if (x !== null && y !== null) return x - y;
  const da = asDate(a);
  const db = asDate(b);
  if (da && db) return dayNumber(da) - dayNumber(db);
  return null;
}

/** Evaluates a condition. Unknown or mistyped input makes a comparison
 * false (never an exception), so a half-answered form just doesn't match. */
export function evaluateCondition(
  condition: Condition,
  ctx: ExprContext,
  depth = 0,
): boolean {
  if (depth > MAX_DEPTH) return false;
  switch (condition.type) {
    case "all":
      return condition.conditions.every((c) => evaluateCondition(c, ctx, depth + 1));
    case "any":
      return condition.conditions.some((c) => evaluateCondition(c, ctx, depth + 1));
    case "not":
      return !evaluateCondition(condition.condition, ctx, depth + 1);
    case "compare":
      return compare(condition, ctx);
  }
}

function compare(c: Extract<Condition, { type: "compare" }>, ctx: ExprContext): boolean {
  const left = evaluateExpr(c.left, ctx);
  const right = c.right ? evaluateExpr(c.right, ctx) : null;

  switch (c.op) {
    case "eq":
      return valuesEqual(left, right);
    case "neq":
      return !valuesEqual(left, right);

    case "gt":
    case "after": {
      const o = order(left, right);
      return o !== null && o > 0;
    }
    case "gte": {
      const o = order(left, right);
      return o !== null && o >= 0;
    }
    case "lt":
    case "before": {
      const o = order(left, right);
      return o !== null && o < 0;
    }
    case "lte": {
      const o = order(left, right);
      return o !== null && o <= 0;
    }
    case "on": {
      const a = asDate(left);
      const b = asDate(right);
      return a !== null && a === b;
    }
    case "between":
    case "not_between": {
      const high = c.right2 ? evaluateExpr(c.right2, ctx) : null;
      const lo = order(left, right);
      const hi = order(left, high);
      if (lo === null || hi === null) return false;
      const inside = lo >= 0 && hi <= 0;
      return c.op === "between" ? inside : !inside;
    }

    case "contains":
    case "not_contains": {
      let has = false;
      if (Array.isArray(left)) {
        has = listOf(right).some((r) => includesItem(left, r));
      } else if (typeof left === "string" && typeof right === "string") {
        has = left.toLowerCase().includes(right.toLowerCase());
      }
      return c.op === "contains" ? has : !has;
    }
    case "starts_with":
      return (
        typeof left === "string" &&
        typeof right === "string" &&
        left.toLowerCase().startsWith(right.toLowerCase())
      );
    case "ends_with":
      return (
        typeof left === "string" &&
        typeof right === "string" &&
        left.toLowerCase().endsWith(right.toLowerCase())
      );
    case "is_empty":
      return isEmptyValue(left);
    case "is_not_empty":
      return !isEmptyValue(left);

    case "any_of": {
      const options = listOf(right);
      return listOf(left).some((v) => includesItem(options, v));
    }
    case "all_of": {
      const chosen = listOf(left);
      const options = listOf(right);
      return options.length > 0 && options.every((o) => includesItem(chosen, o));
    }
    case "none_of": {
      const options = listOf(right);
      return !listOf(left).some((v) => includesItem(options, v));
    }

    case "is_today":
      return asDate(left) === ctx.today;
    case "is_this_week": {
      const d = asDate(left);
      return d !== null && weekIndex(d) === weekIndex(ctx.today);
    }
    case "is_this_month": {
      const d = asDate(left);
      return d !== null && d.slice(0, 7) === ctx.today.slice(0, 7);
    }
    case "is_weekday": {
      const d = asDate(left);
      return d !== null && weekday(d) >= 1 && weekday(d) <= 5;
    }
    case "is_weekend": {
      const d = asDate(left);
      return d !== null && (weekday(d) === 0 || weekday(d) === 6);
    }

    case "is_true":
      return left === true;
    case "is_false":
      return left === false;
  }
}
