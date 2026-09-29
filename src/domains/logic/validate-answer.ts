import type { QuestionV1 } from "@/domains/forms/schema/v1";

/** Prefix for a free-text "Other" choice on single/multi-select, e.g.
 * `"other:Purple"`. Shared with formatAnswerValue and the runtime input
 * so the stored shape has exactly one definition. */
export const OTHER_PREFIX = "other:";

export type AnswerValidation = { ok: true } | { ok: false; message: string };

const OK: AnswerValidation = { ok: true };
const fail = (message: string): AnswerValidation => ({ ok: false, message });

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Deliberately not a `value is string` type guard: narrowing would make
// TypeScript treat the false branch as "not a string at all".
function isOtherValue(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(OTHER_PREFIX);
}

function otherText(value: string): string {
  return value.slice(OTHER_PREFIX.length).trim();
}

/** Whether the respondent actually gave an answer — stricter than a
 * bare non-empty check: a selected-but-blank "Other" doesn't count. */
export function hasAnswer(question: QuestionV1, value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") {
    if (isOtherValue(value)) return otherText(value).length > 0;
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.some((v) =>
      isOtherValue(v) ? otherText(v as string).length > 0 : true,
    );
  }
  if (typeof value === "number") return Number.isFinite(value);
  return question.type === "yes_no" ? typeof value === "boolean" : true;
}

function isValidUrl(raw: string): boolean {
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.includes(".")
    );
  } catch {
    return false;
  }
}

function isValidDate(raw: string): boolean {
  if (!DATE_PATTERN.test(raw)) return false;
  const parsed = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(raw);
}

function validateOption(
  options: { id: string }[],
  allowOther: boolean,
  value: unknown,
): boolean {
  if (typeof value !== "string") return false;
  if (isOtherValue(value)) return allowOther && otherText(value).length > 0;
  return options.some((o) => o.id === value);
}

/**
 * The single source of truth for "is this answer acceptable" — run by
 * the respondent runtime before advancing (instant feedback) and again
 * by completeResponse on the server for every question on the path
 * actually taken (the authoritative check; a client can skip the
 * first, never the second). Empty optional answers are always valid.
 */
export function validateAnswer(question: QuestionV1, value: unknown): AnswerValidation {
  if (question.type === "welcome_screen" || question.type === "statement") return OK;

  if (!hasAnswer(question, value)) {
    return question.required ? fail("This question requires an answer.") : OK;
  }

  switch (question.type) {
    case "short_text":
    case "long_text": {
      if (typeof value !== "string") return fail("Enter a text answer.");
      const length = value.trim().length;
      const { maxLength } = question.settings;
      const minLength =
        question.type === "short_text" ? question.settings.minLength : undefined;
      if (minLength !== undefined && length < minLength) {
        return fail(`Enter at least ${minLength} characters.`);
      }
      if (maxLength !== undefined && length > maxLength) {
        return fail(`Enter at most ${maxLength} characters.`);
      }
      return OK;
    }

    case "email":
      return typeof value === "string" && EMAIL_PATTERN.test(value.trim())
        ? OK
        : fail("Enter a valid email address.");

    case "phone": {
      if (typeof value !== "string" || !/^[\d\s+().-]+$/.test(value.trim())) {
        return fail("Enter a valid phone number.");
      }
      const digits = value.replace(/\D/g, "").length;
      return digits >= 7 && digits <= 15 ? OK : fail("Enter a valid phone number.");
    }

    case "url":
      return typeof value === "string" && isValidUrl(value.trim())
        ? OK
        : fail("Enter a valid URL, like example.com.");

    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return fail("Enter a number.");
      }
      const { min, max, decimals } = question.settings;
      if (min !== undefined && max !== undefined && (value < min || value > max)) {
        return fail(`Enter a number between ${min} and ${max}.`);
      }
      if (min !== undefined && value < min)
        return fail(`Enter a number of at least ${min}.`);
      if (max !== undefined && value > max)
        return fail(`Enter a number of at most ${max}.`);
      if (decimals !== undefined) {
        const fraction = String(value).split(".")[1] ?? "";
        if (fraction.length > decimals) {
          return decimals === 0
            ? fail("Enter a whole number.")
            : fail(`Use at most ${decimals} decimal places.`);
        }
      }
      return OK;
    }

    case "single_select":
      return validateOption(
        question.settings.options,
        question.settings.allowOther,
        value,
      )
        ? OK
        : fail("Choose one of the options.");

    case "dropdown":
      return validateOption(question.settings.options, false, value)
        ? OK
        : fail("Choose one of the options.");

    case "multi_select": {
      if (!Array.isArray(value)) return fail("Choose one or more options.");
      const { options, allowOther, minSelections, maxSelections } = question.settings;
      const chosen = value.filter((v) => !(isOtherValue(v) && otherText(v).length === 0));
      if (!chosen.every((v) => validateOption(options, allowOther, v))) {
        return fail("Choose from the listed options.");
      }
      if (new Set(chosen).size !== chosen.length)
        return fail("Each option can only be chosen once.");
      if (minSelections !== undefined && chosen.length < minSelections) {
        return fail(
          `Choose at least ${minSelections} option${minSelections === 1 ? "" : "s"}.`,
        );
      }
      if (maxSelections !== undefined && chosen.length > maxSelections) {
        return fail(
          `Choose at most ${maxSelections} option${maxSelections === 1 ? "" : "s"}.`,
        );
      }
      return OK;
    }

    case "yes_no":
      return typeof value === "boolean" ? OK : fail("Choose yes or no.");

    case "date": {
      if (typeof value !== "string" || !isValidDate(value))
        return fail("Enter a valid date.");
      const { minDate, maxDate } = question.settings;
      // ISO YYYY-MM-DD strings compare correctly as plain strings.
      if (minDate && value < minDate)
        return fail(`Choose a date on or after ${minDate}.`);
      if (maxDate && value > maxDate)
        return fail(`Choose a date on or before ${maxDate}.`);
      return OK;
    }

    case "rating":
      return Number.isInteger(value) &&
        (value as number) >= 1 &&
        (value as number) <= question.settings.scale
        ? OK
        : fail("Choose a rating.");

    case "opinion_scale":
      return Number.isInteger(value) &&
        (value as number) >= question.settings.min &&
        (value as number) <= question.settings.max
        ? OK
        : fail("Choose a value on the scale.");

    case "file_upload":
      return typeof value === "string" ? OK : fail("Upload a file.");
  }
}
