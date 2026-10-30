import type { QuestionV1 } from "./schema/v1";
import { validateAnswer } from "@/domains/logic/validate-answer";

/**
 * Visible-answer prefill (master spec F-28): `?<key>=value` on a form's
 * link fills in the question with that key. The respondent still sees the
 * question, can change the answer, and it's validated like a typed one —
 * here before it's used, and on the server when it's saved. A value that
 * doesn't fit the question is ignored, not half-applied.
 *
 * Only visible questions are filled. Hidden URL fields are their own
 * thing (and lookups' fields are never taken from a link), so a link
 * can't set anything the respondent doesn't see.
 */

/** Types a link can fill: single values that read naturally as text. */
export const PREFILL_QUESTION_TYPES = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "url",
  "number",
  "single_select",
  "multi_select",
  "dropdown",
  "yes_no",
  "date",
  "time",
  "rating",
  "opinion_scale",
] as const satisfies readonly QuestionV1["type"][];

/** Types holding personal details: the builder warns before letting a
 * link carry them (links end up in browser history and server logs). */
export const PERSONAL_PREFILL_TYPES = new Set<string>(["email", "phone"]);

/** Names FormCraft itself reads from a form's link. */
export const RESERVED_URL_PARAMS = new Set([
  "embed",
  "lang",
  "resume",
  "kiosk",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
]);

export const PREFILL_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

const MAX_PREFILL_LENGTH = 1000;

export function supportsPrefill(question: QuestionV1): boolean {
  return (PREFILL_QUESTION_TYPES as readonly string[]).includes(question.type);
}

function optionFor(
  options: { id: string; label: string }[],
  raw: string,
): string | undefined {
  const wanted = raw.trim().toLowerCase();
  return (
    options.find((o) => o.id === raw.trim())?.id ??
    options.find((o) => o.label.trim().toLowerCase() === wanted)?.id
  );
}

/** A link value as this question's answer, or undefined if it doesn't fit. */
export function prefillValue(question: QuestionV1, raw: string): unknown {
  const text = raw.slice(0, MAX_PREFILL_LENGTH);
  let value: unknown;
  switch (question.type) {
    case "short_text":
    case "long_text":
    case "email":
    case "phone":
    case "url":
    case "date":
    case "time":
      value = text.trim();
      break;
    case "number":
    case "rating":
    case "opinion_scale":
      value = /^-?\d+(\.\d+)?$/.test(text.trim()) ? Number(text.trim()) : undefined;
      break;
    case "yes_no": {
      const t = text.trim().toLowerCase();
      value = ["yes", "true", "1", "y"].includes(t)
        ? true
        : ["no", "false", "0", "n"].includes(t)
          ? false
          : undefined;
      break;
    }
    case "single_select":
    case "dropdown":
      value = optionFor(question.settings.options, text);
      break;
    case "multi_select": {
      const ids = text
        .split(",")
        .map((part) => optionFor(question.settings.options, part));
      value = ids.every(Boolean) ? [...new Set(ids)] : undefined;
      break;
    }
    default:
      return undefined;
  }
  if (value === undefined || value === "") return undefined;
  return validateAnswer(question, value).ok ? value : undefined;
}

/** Answers a link fills in, by question id. */
export function prefillFromParams(
  questions: QuestionV1[],
  params: URLSearchParams,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const question of questions) {
    if (!question.prefillKey || !supportsPrefill(question)) continue;
    const raw = params.get(question.prefillKey);
    if (raw === null) continue;
    const value = prefillValue(question, raw);
    if (value !== undefined) out[question.id] = value;
  }
  return out;
}
