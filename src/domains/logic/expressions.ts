import type { Expr, Value } from "@/domains/forms/schema/logic-model";

/** What an expression can read. Answers are raw stored values. */
export type ExprContext = {
  answers: Record<string, unknown>;
  /** Current variable values, by variable id. */
  variables: Record<string, Value>;
  /** URL / hidden-field values, by name. */
  hidden: Record<string, string>;
  /** "Today" as YYYY-MM-DD in the form's timezone — pinned per evaluation
   * so a replay gives the same answer. */
  today: string;
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** A finite number, or null. NaN and ±Infinity never escape the engine. */
export function finite(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

export function asNumber(v: unknown): number | null {
  if (typeof v === "number") return finite(v);
  if (typeof v === "string" && v.trim() !== "" && /^-?\d+(\.\d+)?$/.test(v.trim())) {
    return finite(Number(v));
  }
  return null;
}

/** `YYYY-MM-DD` from a date-ish string, or null. */
export function asDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = DATE_RE.exec(v);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  // Reject impossible dates like 2026-02-31.
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d))
    return null;
  return `${y}-${mo}-${d}`;
}

export function dayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Normalises any stored answer into an engine Value. */
export function toValue(raw: unknown, field?: string): Value {
  if (raw === undefined || raw === null) return null;
  if (field) {
    if (typeof raw === "object" && !Array.isArray(raw)) {
      const v = (raw as Record<string, unknown>)[field];
      return typeof v === "string" || typeof v === "number" || typeof v === "boolean"
        ? v
        : null;
    }
    return null;
  }
  if (typeof raw === "string" || typeof raw === "boolean") return raw;
  if (typeof raw === "number") return finite(raw);
  if (Array.isArray(raw)) {
    return raw.filter(
      (x): x is string | number => typeof x === "string" || typeof x === "number",
    );
  }
  // An object answer (contact info) as a whole: its filled fields, joined.
  if (typeof raw === "object") {
    const text = Object.values(raw as Record<string, unknown>)
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .join(" ");
    return text || null;
  }
  return null;
}

function numbersIn(values: Value[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (Array.isArray(v)) {
      for (const x of v) {
        const n = asNumber(x);
        if (n !== null) out.push(n);
      }
    } else {
      const n = asNumber(v);
      if (n !== null) out.push(n);
    }
  }
  return out;
}

function isEmptyValue(v: Value): boolean {
  return v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

/**
 * Evaluates an expression. Total: wrong types, missing answers,
 * division by zero and overflow all produce `null` rather than throwing
 * or returning NaN, and `null` flows through arithmetic (null + 1 = null)
 * except in the aggregate functions, which skip it.
 */
export function evaluateExpr(expr: Expr, ctx: ExprContext, depth = 0): Value {
  if (depth > 32) return null;
  switch (expr.type) {
    case "literal":
      return expr.value;
    case "answer":
      return toValue(ctx.answers[expr.questionId], expr.field);
    case "variable":
      return ctx.variables[expr.variableId] ?? null;
    case "hidden":
      return ctx.hidden[expr.name] ?? null;
    case "binary": {
      const left = evaluateExpr(expr.left, ctx, depth + 1);
      const right = evaluateExpr(expr.right, ctx, depth + 1);
      // Two pieces of text join; anything else is arithmetic.
      if (expr.op === "+" && typeof left === "string" && typeof right === "string") {
        return left + right;
      }
      const a = asNumber(left);
      const b = asNumber(right);
      if (a === null || b === null) return null;
      switch (expr.op) {
        case "+":
          return finite(a + b);
        case "-":
          return finite(a - b);
        case "*":
          return finite(a * b);
        case "/":
          return b === 0 ? null : finite(a / b);
        case "%":
          return b === 0 ? null : finite(a % b);
      }
      return null;
    }
    case "call":
      return callFunction(expr, ctx, depth);
  }
}

function callFunction(
  expr: Extract<Expr, { type: "call" }>,
  ctx: ExprContext,
  depth: number,
): Value {
  const args = expr.args.map((a) => evaluateExpr(a, ctx, depth + 1));
  switch (expr.fn) {
    case "SUM": {
      const ns = numbersIn(args);
      return finite(ns.reduce((s, n) => s + n, 0));
    }
    case "AVG": {
      const ns = numbersIn(args);
      return ns.length === 0 ? null : finite(ns.reduce((s, n) => s + n, 0) / ns.length);
    }
    case "MIN": {
      const ns = numbersIn(args);
      return ns.length === 0 ? null : Math.min(...ns);
    }
    case "MAX": {
      const ns = numbersIn(args);
      return ns.length === 0 ? null : Math.max(...ns);
    }
    case "COUNT":
      return args.reduce<number>(
        (n, v) => n + (Array.isArray(v) ? v.length : isEmptyValue(v) ? 0 : 1),
        0,
      );
    case "ROUND": {
      const n = asNumber(args[0]);
      const digits = Math.max(0, Math.min(10, Math.trunc(asNumber(args[1]) ?? 0)));
      if (n === null) return null;
      const f = 10 ** digits;
      return finite(Math.round(n * f) / f);
    }
    case "CEIL": {
      const n = asNumber(args[0]);
      return n === null ? null : Math.ceil(n);
    }
    case "FLOOR": {
      const n = asNumber(args[0]);
      return n === null ? null : Math.floor(n);
    }
    case "ABS": {
      const n = asNumber(args[0]);
      return n === null ? null : Math.abs(n);
    }
    case "PERCENTAGE": {
      const part = asNumber(args[0]);
      const whole = asNumber(args[1]);
      if (part === null || whole === null || whole === 0) return null;
      return finite((part / whole) * 100);
    }
    case "LENGTH": {
      const v = args[0];
      if (typeof v === "string") return v.length;
      if (Array.isArray(v)) return v.length;
      return v === null ? 0 : null;
    }
    case "TODAY":
      return ctx.today;
    case "DAYS_BETWEEN": {
      const a = asDate(args[0]);
      const b = asDate(args[1]);
      if (!a || !b) return null;
      return dayNumber(b) - dayNumber(a);
    }
    case "AGE": {
      const dob = asDate(args[0]);
      const on = asDate(args[1] ?? ctx.today) ?? ctx.today;
      if (!dob) return null;
      const [by, bm, bd] = dob.split("-").map(Number);
      const [ty, tm, td] = on.split("-").map(Number);
      let age = ty - by;
      if (tm < bm || (tm === bm && td < bd)) age -= 1;
      return age;
    }
  }
}

/** "Today" (YYYY-MM-DD) for an instant in an IANA zone; UTC if the zone
 * is unknown. */
export function todayIn(now: Date, timeZone: string | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
