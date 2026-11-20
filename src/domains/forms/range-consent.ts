import type { QuestionV1 } from "./schema/v1";

type DateRangeQuestion = Extract<QuestionV1, { type: "date_range" }>;
export type ConsentQuestion = Extract<QuestionV1, { type: "consent" }>;

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real YYYY-MM-DD calendar day (not 2026-02-30). */
export function isCalendarDay(raw: unknown): raw is string {
  if (typeof raw !== "string" || !ISO_DAY.test(raw)) return false;
  const parsed = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(raw);
}

/** Days since 1970-01-01 for a calendar day, in UTC so no clock change
 * or time zone moves it. */
function dayNumber(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** A range's length in the question's unit: days counts both ends
 * (Mon–Wed is 3 days), nights doesn't (Mon–Wed is 2 nights). */
export function rangeLength(
  start: string,
  end: string,
  count: "days" | "nights" = "days",
): number {
  const nights = dayNumber(end) - dayNumber(start);
  return count === "nights" ? nights : nights + 1;
}

export type DateRangeAnswer = { start: string; end: string; days: number };

/** The two dates out of whatever was sent, or null. */
export function rangeParts(value: unknown): { start?: unknown; end?: unknown } | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as { start?: unknown; end?: unknown })
    : null;
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function unit(n: number, count: "days" | "nights"): string {
  const word = count === "nights" ? "night" : "day";
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Why a range isn't acceptable, or null. `show` formats a date for the
 * message the way the respondent's date field does. */
export function dateRangeProblem(
  question: DateRangeQuestion,
  value: unknown,
  show: (iso: string) => string = (iso) => iso,
): string | null {
  const parts = rangeParts(value);
  if (!parts || !isCalendarDay(parts.start) || !isCalendarDay(parts.end)) {
    return "Choose a start and an end date.";
  }
  const { start, end } = parts as { start: string; end: string };
  const s = question.settings;
  const count = s.count ?? "days";
  if (end < start) return "The end date can't be before the start date.";
  if (count === "nights" && end === start) {
    return "Choose an end date after the start date.";
  }
  if (s.minDate && start < s.minDate) {
    return `Choose dates on or after ${show(s.minDate)}.`;
  }
  if (s.maxDate && end > s.maxDate) {
    return `Choose dates on or before ${show(s.maxDate)}.`;
  }
  for (const [day, which] of [
    [start, "start"],
    [end, "end"],
  ] as const) {
    if (s.disabledDates?.includes(day)) {
      return `${show(day)} isn't available. Choose another ${which} date.`;
    }
    if (s.disabledWeekdays?.includes(weekdayOf(day))) {
      return `The ${which} date can't be a ${WEEKDAY_NAMES[weekdayOf(day)]}.`;
    }
  }
  const length = rangeLength(start, end, count);
  if (s.minDays !== undefined && length < s.minDays) {
    return `Choose at least ${unit(s.minDays, count)}.`;
  }
  if (s.maxDays !== undefined && length > s.maxDays) {
    return `Choose at most ${unit(s.maxDays, count)}.`;
  }
  return null;
}

/** What's stored: the two dates and the length the server worked out. */
export function normalizeDateRange(
  question: DateRangeQuestion,
  value: unknown,
): DateRangeAnswer | unknown {
  const parts = rangeParts(value);
  if (!parts || !isCalendarDay(parts.start) || !isCalendarDay(parts.end)) return value;
  const start = parts.start as string;
  const end = parts.end as string;
  return { start, end, days: rangeLength(start, end, question.settings.count) };
}

export function formatDateRange(
  question: DateRangeQuestion,
  value: unknown,
  show: (iso: string) => string = (iso) => iso,
): string {
  const parts = rangeParts(value);
  if (!parts || !isCalendarDay(parts.start) || !isCalendarDay(parts.end)) return "";
  const start = parts.start as string;
  const end = parts.end as string;
  const count = question.settings.count ?? "days";
  return `${show(start)} – ${show(end)} (${unit(rangeLength(start, end, count), count)})`;
}

// --- consent (F-62) ------------------------------------------------------

export const CONSENT_KIND_LABELS: Record<string, string> = {
  privacy: "Privacy notice",
  terms: "Terms",
  data_sharing: "Data-sharing consent",
  marketing: "Marketing consent",
  medical: "Medical disclosure",
  other: "Other notice",
};

export type ConsentAnswer = {
  acknowledged: boolean;
  /** The kind of notice (CONSENT_KINDS), when the creator chose one. */
  kind?: string;
  optIn?: boolean;
  /** The notice's hash (consentVersion), set by the server. */
  version: string;
  versionLabel?: string;
  /** When the server saved it, ISO 8601 (UTC). */
  acceptedAt: string;
};

export function consentParts(value: unknown): {
  acknowledged?: unknown;
  optIn?: unknown;
} | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as { acknowledged?: unknown; optIn?: unknown })
    : null;
}

export function consentProblem(question: ConsentQuestion, value: unknown): string | null {
  const parts = consentParts(value);
  if (value !== undefined && value !== null && !parts) return "Tick the box to go on.";
  if (
    parts &&
    parts.acknowledged !== undefined &&
    typeof parts.acknowledged !== "boolean"
  ) {
    return "Tick the box to go on.";
  }
  if (parts && parts.optIn !== undefined && typeof parts.optIn !== "boolean") {
    return "Tick the box to go on.";
  }
  if (question.required && parts?.acknowledged !== true) {
    return "Tick the box to go on.";
  }
  return null;
}

export function formatConsent(value: unknown): string {
  const parts = consentParts(value) as Partial<ConsentAnswer> | null;
  if (!parts || typeof parts.acknowledged !== "boolean") return "";
  const bits = [parts.acknowledged ? "Accepted" : "Not accepted"];
  if (typeof parts.optIn === "boolean")
    bits.push(`opt-in: ${parts.optIn ? "yes" : "no"}`);
  const version = [
    parts.kind ? CONSENT_KIND_LABELS[parts.kind] : undefined,
    parts.versionLabel,
    parts.version && `#${parts.version}`,
  ]
    .filter(Boolean)
    .join(" ");
  if (version) bits.push(`notice ${version}`);
  if (typeof parts.acceptedAt === "string") bits.push(parts.acceptedAt);
  return bits.join(" · ");
}
