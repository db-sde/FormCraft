import {
  EXPRESSION_FUNCTIONS,
  type Expr,
  type ExpressionFunction,
} from "@/domains/forms/schema/logic-model";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";

/**
 * Formulas as creators type them — `q2 * price + 10`,
 * `ROUND(score / max_score * 100)`, `"Hi " + q1.name` — parsed into the
 * engine's expression AST (never evaluated as code). Questions are
 * written `q<number>` as numbered in the builder and stored by id, so a
 * formula survives reordering; variables and URL fields by name.
 */

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

export type FormulaResult = { ok: true; expr: Expr } | { ok: false; message: string };

function tokenize(input: string): Token[] | string {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(?:[eE][-+]?\d+)?/.exec(input.slice(i));
      if (!m) return `“${c}” isn't a number.`;
      tokens.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = input.indexOf(c, i + 1);
      if (end < 0) return "A piece of text is missing its closing quote.";
      tokens.push({ t: "str", v: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_]+)?/.exec(input.slice(i))!;
      tokens.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    if ("+-*/%(),".includes(c)) {
      tokens.push({ t: "op", v: c });
      i += 1;
      continue;
    }
    return `“${c}” can't be used in a formula.`;
  }
  return tokens;
}

export function parseFormula(input: string, schema: FormSchemaV1): FormulaResult {
  const tokenized = tokenize(input);
  if (typeof tokenized === "string") return { ok: false, message: tokenized };
  if (tokenized.length === 0) return { ok: false, message: "Enter a formula." };
  const tokens: Token[] = tokenized;

  const ordered = [...schema.questions]
    .sort((a, b) => a.order - b.order)
    .filter((q) => q.type !== "welcome_screen");
  const variables = new Map((schema.variables ?? []).map((v) => [v.name, v]));
  const hidden = new Set((schema.hiddenFields ?? []).map((h) => h.name));

  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.t === "op" && peek()?.v === v;

  function fail(message: string): never {
    throw new Error(message);
  }

  function expression(): Expr {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = (tokens[pos++] as { v: "+" | "-" }).v;
      left = { type: "binary", op, left, right: term() };
    }
    return left;
  }

  function term(): Expr {
    let left = factor();
    while (isOp("*") || isOp("/") || isOp("%")) {
      const op = (tokens[pos++] as { v: "*" | "/" | "%" }).v;
      left = { type: "binary", op, left, right: factor() };
    }
    return left;
  }

  function factor(): Expr {
    const token = tokens[pos++];
    if (!token) fail("The formula ends too early.");
    if (token.t === "num") return { type: "literal", value: token.v };
    if (token.t === "str") return { type: "literal", value: token.v };
    if (token.t === "op" && token.v === "-") {
      return {
        type: "binary",
        op: "-",
        left: { type: "literal", value: 0 },
        right: factor(),
      };
    }
    if (token.t === "op" && token.v === "(") {
      const inner = expression();
      if (!isOp(")")) fail("A bracket is missing its closing “)”.");
      pos += 1;
      return inner;
    }
    if (token.t === "id") return identifier(token.v);
    fail(`“${token.v}” is in the wrong place.`);
  }

  function identifier(name: string): Expr {
    const upper = name.toUpperCase();
    if (isOp("(")) {
      if (!(EXPRESSION_FUNCTIONS as readonly string[]).includes(upper)) {
        fail(`${name} isn't a function you can use.`);
      }
      pos += 1;
      const args: Expr[] = [];
      if (!isOp(")")) {
        args.push(expression());
        while (isOp(",")) {
          pos += 1;
          args.push(expression());
        }
      }
      if (!isOp(")")) fail(`${upper}( is missing its closing “)”.`);
      pos += 1;
      return { type: "call", fn: upper as ExpressionFunction, args };
    }
    if (name === "true" || name === "false")
      return { type: "literal", value: name === "true" };
    const question = /^q(\d+)(?:\.([a-z]+))?$/i.exec(name);
    if (question) {
      const q = ordered[Number(question[1]) - 1];
      if (!q) fail(`There's no question ${question[1]}.`);
      return { type: "answer", questionId: q.id, field: question[2]?.toLowerCase() };
    }
    const variable = variables.get(name);
    if (variable) return { type: "variable", variableId: variable.id };
    if (hidden.has(name)) return { type: "hidden", name };
    fail(`“${name}” isn't a question, variable or URL field.`);
  }

  try {
    const expr = expression();
    if (pos < tokens.length) {
      const extra = tokens[pos];
      return {
        ok: false,
        message: `“${"v" in extra ? extra.v : ""}” is in the wrong place.`,
      };
    }
    return { ok: true, expr };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

const PRECEDENCE: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2 };

/** The formula text for an expression (inverse of parseFormula). */
export function printFormula(expr: Expr, schema: FormSchemaV1, parent = 0): string {
  switch (expr.type) {
    case "literal":
      if (typeof expr.value === "string") return JSON.stringify(expr.value);
      if (Array.isArray(expr.value))
        return expr.value.map((v) => JSON.stringify(v)).join(", ");
      return String(expr.value);
    case "answer": {
      const ordered = [...schema.questions]
        .sort((a, b) => a.order - b.order)
        .filter((q) => q.type !== "welcome_screen");
      const n = ordered.findIndex((q) => q.id === expr.questionId) + 1;
      const base = n > 0 ? `q${n}` : "q?";
      return expr.field ? `${base}.${expr.field}` : base;
    }
    case "variable":
      return (
        (schema.variables ?? []).find((v) => v.id === expr.variableId)?.name ?? "unknown"
      );
    case "hidden":
      return expr.name;
    case "call":
      return `${expr.fn}(${expr.args.map((a) => printFormula(a, schema)).join(", ")})`;
    case "binary": {
      // Unary minus round-trips as written.
      if (expr.op === "-" && expr.left.type === "literal" && expr.left.value === 0) {
        return `-${printFormula(expr.right, schema, 3)}`;
      }
      const p = PRECEDENCE[expr.op];
      const text = `${printFormula(expr.left, schema, p)} ${expr.op} ${printFormula(
        expr.right,
        schema,
        p + 1,
      )}`;
      return p < parent ? `(${text})` : text;
    }
  }
}
