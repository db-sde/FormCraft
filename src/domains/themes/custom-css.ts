/**
 * Custom CSS on a form (master spec F-14). The creator's CSS lives in the
 * form's theme, so it's versioned with the draft and goes live only when
 * the form is published.
 *
 * It can only style the form. The page wraps it in the form's own scope
 * with CSS nesting (`.fc-custom-scope { … }`), so a selector written for
 * the whole page (`body`, `button`) only reaches elements inside the form,
 * and the dashboard and builder never load it. The page's CSP stays as it
 * is: inline styles were already allowed, scripts and frames still aren't,
 * and `url()` can only load images from this site and the form's uploads.
 *
 * What's refused outright (an error, so the draft won't save) is what
 * could escape the style sheet or load anything: `<` (it could close the
 * `<style>` element), `@import`, script URLs and the old script-in-CSS
 * extensions. Syntax slips (an unclosed brace) are warnings: the browser
 * skips what it can't read, and the creator sees why in the builder.
 */

export const MAX_CUSTOM_CSS_LENGTH = 20_000;

/** The class the page puts on the form's outermost element; the creator's
 * CSS is nested inside it. */
export const CUSTOM_CSS_SCOPE = "fc-custom-scope";

export type CssProblem = { severity: "error" | "warning"; message: string };

const FORBIDDEN: { pattern: RegExp; message: string }[] = [
  { pattern: /</, message: "Remove “<”: it isn't needed in CSS." },
  { pattern: /@import/i, message: "@import isn't allowed: put the styles here instead." },
  {
    pattern: /@(font-face|namespace|charset|layer\s*[^{;]*;)/i,
    message:
      "@font-face, @namespace, @charset and layer statements aren't allowed. Use the Design panel for fonts.",
  },
  { pattern: /javascript\s*:/i, message: "Script URLs aren't allowed." },
  { pattern: /vbscript\s*:/i, message: "Script URLs aren't allowed." },
  { pattern: /expression\s*\(/i, message: "expression() isn't allowed." },
  { pattern: /-moz-binding/i, message: "-moz-binding isn't allowed." },
  { pattern: /behaviou?r\s*:/i, message: "behavior isn't allowed." },
  { pattern: /\\/, message: "Remove backslashes: escapes aren't supported here." },
];

/** Problems with a form's custom CSS. Errors mean it can't be saved. */
export function customCssProblems(css: string): CssProblem[] {
  const problems: CssProblem[] = [];
  if (css.length > MAX_CUSTOM_CSS_LENGTH) {
    problems.push({
      severity: "error",
      message: `Keep it under ${MAX_CUSTOM_CSS_LENGTH.toLocaleString("en-US")} characters.`,
    });
  }
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(css))
      problems.push({ severity: "error", message: rule.message });
  }
  problems.push(...syntaxWarnings(css));
  return problems;
}

export function customCssErrors(css: string): string[] {
  return customCssProblems(css)
    .filter((p) => p.severity === "error")
    .map((p) => p.message);
}

/** Braces, comments and strings that don't close. A stray `}` would end
 * the scope early and let later rules reach the whole page, so it's an
 * error; the others only cost the creator their own rules. */
function syntaxWarnings(css: string): CssProblem[] {
  const problems: CssProblem[] = [];
  let depth = 0;
  let line = 1;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === "\n") line += 1;
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) {
        problems.push({
          severity: "warning",
          message: `A comment on line ${line} never ends.`,
        });
        return problems;
      }
      line += css.slice(i, end).split("\n").length - 1;
      i = end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = css.indexOf(ch, i + 1);
      const newline = css.indexOf("\n", i + 1);
      if (end === -1 || (newline !== -1 && newline < end)) {
        problems.push({
          severity: "warning",
          message: `A quote on line ${line} never closes.`,
        });
        return problems;
      }
      i = end;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth < 0) {
        problems.push({
          severity: "error",
          message: `Line ${line} closes a “}” that was never opened.`,
        });
        return problems;
      }
    }
  }
  if (depth > 0) {
    problems.push({
      severity: "warning",
      message: `${depth} “{” ${depth === 1 ? "isn't" : "aren't"} closed.`,
    });
  }
  return problems;
}

/** The style sheet the page renders: the creator's CSS nested in the
 * form's scope. Callers render it only after the CSS passed
 * customCssErrors (the schema refuses it otherwise). An unclosed brace is
 * closed here so it can't swallow the scope's own. */
export function scopedCustomCss(css: string | undefined): string | null {
  const body = css?.trim();
  if (!body || customCssErrors(body).length > 0) return null;
  let depth = 0;
  let inComment = false;
  let quote: string | null = null;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inComment) {
      if (ch === "*" && body[i + 1] === "/") inComment = false;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && body[i + 1] === "*") inComment = true;
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
  }
  const closing =
    (inComment ? "*/" : "") + (quote ?? "") + "}".repeat(Math.max(0, depth));
  return `.${CUSTOM_CSS_SCOPE}{${body}${closing}}`;
}
