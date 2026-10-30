/**
 * Time and date-time answers (master spec F-20), shared by the runtime and
 * the server so both read them the same way.
 *
 * Storage:
 * - time: 24-hour `HH:mm`, a time of day with no zone (opening hours,
 *   "usual bedtime").
 * - date-time: `YYYY-MM-DDTHH:mm±HH:MM`, the wall time the respondent
 *   picked plus its UTC offset, so the moment is exact and the local time
 *   they saw is kept. With a fixed zone on the question (an event's venue)
 *   the offset is that zone's on that date — daylight saving included —
 *   and the server checks it. Without one, it's the respondent's own.
 *
 * Daylight saving: a wall time that doesn't exist in the fixed zone (the
 * hour skipped when clocks go forward) is refused; one that happens twice
 * (clocks going back) accepts either offset, and the picker uses the
 * first.
 */

export const DATETIME_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;
const WALL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function minutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function timeFromMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** The times a picker offers: every `step` minutes from the earliest
 * (midnight when unset) to the latest. */
export function offeredTimes(settings: {
  minTime?: string;
  maxTime?: string;
  stepMinutes?: number;
}): string[] {
  const step = settings.stepMinutes ?? 5;
  const from = settings.minTime ? minutesOfDay(settings.minTime) : 0;
  const to = settings.maxTime ? minutesOfDay(settings.maxTime) : 23 * 60 + 59;
  const out: string[] = [];
  for (let m = from; m <= to; m += step) out.push(timeFromMinutes(m));
  return out;
}

/** Whether a 24-hour time fits the question's window and step. */
export function timeFits(
  time: string,
  settings: { minTime?: string; maxTime?: string; stepMinutes?: number },
): { ok: true } | { ok: false; reason: "early" | "late" | "step" } {
  const m = minutesOfDay(time);
  if (settings.minTime && m < minutesOfDay(settings.minTime))
    return { ok: false, reason: "early" };
  if (settings.maxTime && m > minutesOfDay(settings.maxTime))
    return { ok: false, reason: "late" };
  const base = settings.minTime ? minutesOfDay(settings.minTime) : 0;
  if (settings.stepMinutes && (m - base) % settings.stepMinutes !== 0)
    return { ok: false, reason: "step" };
  return { ok: true };
}

/** "14:30" → "2:30 PM" (12-hour) or "14:30". */
export function displayTime(time: string, hourCycle: "12" | "24" = "24"): string {
  if (hourCycle === "24") return time;
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** The zone's offset from UTC (minutes) at an instant. */
export function zoneOffsetMinutes(timeZone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60_000);
}

/** The UTC offsets (minutes) a wall time (`YYYY-MM-DDTHH:mm`) can have in
 * a zone: one normally, none in a spring-forward gap, two in a fall-back
 * overlap (earliest moment first). */
export function offsetsForWallTime(wall: string, timeZone: string): number[] {
  const m = WALL_PATTERN.exec(wall);
  if (!m) return [];
  const wallUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const candidates = new Set([
    zoneOffsetMinutes(timeZone, wallUtc - 12 * 3_600_000),
    zoneOffsetMinutes(timeZone, wallUtc + 12 * 3_600_000),
  ]);
  const valid = [...candidates].filter(
    (offset) => zoneOffsetMinutes(timeZone, wallUtc - offset * 60_000) === offset,
  );
  // A larger offset means an earlier moment for the same wall time.
  return valid.sort((a, b) => b - a);
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

function parseOffset(text: string): number {
  if (text === "Z") return 0;
  const sign = text.startsWith("-") ? -1 : 1;
  const [h, m] = text.slice(1).split(":").map(Number);
  return sign * (h * 60 + m);
}

export type DateTimeParts = { date: string; time: string; offsetMinutes: number };

export function parseDateTime(value: string): DateTimeParts | null {
  const m = DATETIME_PATTERN.exec(value);
  if (!m) return null;
  return { date: m[1], time: `${m[2]}:${m[3]}`, offsetMinutes: parseOffset(m[4]) };
}

/** A stored value for a wall time: in the question's zone if it has one,
 * else in this browser's. Null when the wall time doesn't exist there. */
export function dateTimeValue(
  date: string,
  time: string,
  timeZone: string | undefined,
  now: () => Date = () => new Date(`${date}T${time}:00`),
): string | null {
  const wall = `${date}T${time}`;
  if (timeZone) {
    const offsets = offsetsForWallTime(wall, timeZone);
    return offsets.length ? `${wall}${formatOffset(offsets[0])}` : null;
  }
  // The browser's own zone: getTimezoneOffset is minutes *behind* UTC.
  const local = now();
  if (Number.isNaN(local.getTime())) return null;
  return `${wall}${formatOffset(-local.getTimezoneOffset())}`;
}

/** "2026-11-03 14:30 (UTC+05:30)" — exports, dashboard, recall. */
export function formatDateTime(value: string, hourCycle: "12" | "24" = "24"): string {
  const parts = parseDateTime(value);
  if (!parts) return value;
  const zone =
    parts.offsetMinutes === 0 ? "UTC" : `UTC${formatOffset(parts.offsetMinutes)}`;
  return `${parts.date} ${displayTime(parts.time, hourCycle)} (${zone})`;
}

/** The moment a stored date-time stands for, as an ISO string in UTC. */
export function dateTimeInstant(value: string): string | null {
  const parts = parseDateTime(value);
  if (!parts) return null;
  const [y, mo, d] = parts.date.split("-").map(Number);
  const [h, mi] = parts.time.split(":").map(Number);
  const utc = Date.UTC(y, mo - 1, d, h, mi) - parts.offsetMinutes * 60_000;
  return new Date(utc).toISOString();
}
