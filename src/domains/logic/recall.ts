import { UPLOAD_ANSWER_TYPES } from "@/domains/forms/schema/question-types";
import type { Value } from "@/domains/forms/schema/logic-model";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { formatAnswerValue } from "@/domains/responses/format";

/**
 * Recall / dynamic text: `{{score}}` (a variable or URL field by name)
 * and `{{answer:QUESTION_ID}}` (a respondent's answer, formatted as in
 * the dashboard). Output is plain text — callers render it as text (React
 * escapes it), never as HTML. Unknown names render as nothing rather
 * than showing braces to a respondent.
 */
export const RECALL_PATTERN = /\{\{\s*(answer:[A-Za-z0-9_-]+|[a-z][a-z0-9_]*)\s*\}\}/g;

export type RecallSource = {
  schema: FormSchemaV1;
  answers: Record<string, unknown>;
  /** By variable id. */
  variables: Record<string, Value>;
  hidden: Record<string, string>;
};

export function formatValue(value: Value | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? String(value)
      : value.toLocaleString("en-US", { maximumFractionDigits: 2, useGrouping: false });
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

function lookup(token: string, source: RecallSource): string {
  if (token.startsWith("answer:")) {
    const questionId = token.slice("answer:".length);
    const question = source.schema.questions.find((q) => q.id === questionId);
    return question ? formatAnswerValue(question, source.answers[questionId]) : "";
  }
  const variable = (source.schema.variables ?? []).find((v) => v.name === token);
  if (variable) return formatValue(source.variables[variable.id]);
  return source.hidden[token] ?? "";
}

export function hasRecall(text: string | undefined): boolean {
  return !!text && /\{\{/.test(text);
}

export function renderRecall(text: string, source: RecallSource): string;
export function renderRecall(
  text: string | undefined,
  source: RecallSource,
): string | undefined;
export function renderRecall(text: string | undefined, source: RecallSource) {
  if (!text || !hasRecall(text)) return text;
  return text.replace(RECALL_PATTERN, (_m, token: string) => lookup(token, source));
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** For links (an ending's redirect): each value is URL-encoded, and the
 * result must keep the creator's own host — otherwise a crafted link
 * (`?site=evil.example`) could send respondents anywhere — so a value
 * that would change the host is dropped. */
export function renderRecallUrl(url: string, source: RecallSource): string {
  if (!hasRecall(url)) return url;
  const bare = url.replace(RECALL_PATTERN, "");
  const rendered = url.replace(RECALL_PATTERN, (_m, token: string) =>
    encodeURIComponent(lookup(token, source)),
  );
  const expected = hostOf(bare);
  return expected !== null && hostOf(rendered) === expected ? rendered : bare;
}

/** Tokens a creator can insert, for the builder's picker. */
export function recallTokens(schema: FormSchemaV1): { token: string; label: string }[] {
  return [
    ...(schema.variables ?? []).map((v) => ({ token: `{{${v.name}}}`, label: v.name })),
    ...(schema.hiddenFields ?? []).map((h) => ({
      token: `{{${h.name}}}`,
      label: `${h.name} (URL)`,
    })),
    ...[...schema.questions]
      .sort((a, b) => a.order - b.order)
      .filter(
        (q) =>
          q.type !== "welcome_screen" &&
          q.type !== "statement" &&
          q.type !== "page_break" &&
          !UPLOAD_ANSWER_TYPES.has(q.type),
      )
      .map((q) => ({
        token: `{{answer:${q.id}}}`,
        label: q.label || "Untitled question",
      })),
  ];
}

/**
 * Placeholders in `text` that would show as blank (QA FC15-41): a name
 * that's no score or URL field, an answer id that's no question, or an
 * answer to a question that comes later (or is this one). Each is
 * returned as written, braces included.
 */
export function unknownRecallTokens(
  text: string | undefined,
  schema: FormSchemaV1,
  /** Where the text is: answers from here on aren't given yet. */
  atQuestionId?: string,
): string[] {
  if (!text || !hasRecall(text)) return [];
  const ordered = [...schema.questions].sort((a, b) => a.order - b.order);
  const at = atQuestionId ? ordered.findIndex((q) => q.id === atQuestionId) : -1;
  const names = new Set([
    ...(schema.variables ?? []).map((v) => v.name),
    ...(schema.hiddenFields ?? []).map((h) => h.name),
  ]);
  const unknown: string[] = [];
  for (const match of text.matchAll(RECALL_PATTERN)) {
    const token = match[1];
    if (token.startsWith("answer:")) {
      const index = ordered.findIndex((q) => q.id === token.slice("answer:".length));
      if (index === -1 || (at !== -1 && index >= at)) unknown.push(match[0]);
    } else if (!names.has(token)) unknown.push(match[0]);
  }
  // Something that looks meant as recall but isn't the pattern ({{ Your name }}).
  for (const loose of text.match(/\{\{[^}]*\}\}/g) ?? []) {
    if (!new RegExp(RECALL_PATTERN.source).test(loose)) unknown.push(loose);
  }
  return [...new Set(unknown)];
}

/** What the builder's recall menu offers at a question: answers to the
 * questions before it, scores and URL fields. */
export function recallChoices(
  schema: FormSchemaV1,
  atQuestionId?: string,
): { token: string; label: string }[] {
  const ordered = [...schema.questions].sort((a, b) => a.order - b.order);
  const at = atQuestionId ? ordered.findIndex((q) => q.id === atQuestionId) : -1;
  const earlier = new Set(
    (at === -1 ? ordered : ordered.slice(0, at)).map((q) => `{{answer:${q.id}}}`),
  );
  return recallTokens(schema).filter(
    (t) => !t.token.startsWith("{{answer:") || earlier.has(t.token),
  );
}
