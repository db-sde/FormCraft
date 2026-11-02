import { z } from "zod";
import { isValidTimeZone, offsetsForWallTime } from "@/domains/logic/datetime";

/**
 * Native bookings (master spec F-27) — the pure part: which slots a
 * booking type offers and which hosts are free for each. Shared by the
 * slot API, the server's check at submit, and tests.
 *
 * Times: weekly hours are wall-clock times in the booking type's own time
 * zone. Each candidate is converted with that zone's offset on that date,
 * so daylight saving is right: a time that doesn't exist (clocks going
 * forward) isn't offered; one that happens twice (clocks going back) is
 * offered once, at its first occurrence. Everything after that is UTC.
 */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const WeeklyWindow = z
  .object({
    day: z.number().int().min(0).max(6),
    start: z.string().regex(HHMM),
    end: z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/),
  })
  .refine((w) => w.start < w.end, "a window must end after it starts");
export type WeeklyWindow = z.infer<typeof WeeklyWindow>;

export const BookingRules = z.object({
  durationMinutes: z.number().int().min(5).max(480),
  intervalMinutes: z.number().int().min(5).max(480).nullable(),
  bufferBeforeMinutes: z.number().int().min(0).max(240),
  bufferAfterMinutes: z.number().int().min(0).max(240),
  minNoticeMinutes: z.number().int().min(0).max(20160),
  maxDaysAhead: z.number().int().min(1).max(365),
  timeZone: z.string().refine(isValidTimeZone, "not a time zone"),
  weekly: z.array(WeeklyWindow).max(50),
  blockedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366),
});
export type BookingRules = z.infer<typeof BookingRules>;

export type Interval = { start: number; end: number };

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const hhmm = (mins: number) =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

/** YYYY-MM-DD for an instant in a zone. */
export function dateIn(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The UTC instant of a wall time in a zone, or null in a DST gap. */
export function instantOf(date: string, time: string, timeZone: string): number | null {
  const [offset] = offsetsForWallTime(`${date}T${time}`, timeZone);
  if (offset === undefined) return null;
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) - offset * 60_000;
}

/**
 * Candidate slot starts (UTC ms) on the booking type's local dates from
 * `fromDate` to `toDate`, inside its weekly hours, not on blocked dates,
 * at least `minNotice` after `now` and no further ahead than
 * `maxDaysAhead` (counted from today in its zone).
 */
export function candidateStarts(
  rules: BookingRules,
  fromDate: string,
  toDate: string,
  now: number,
): number[] {
  const today = dateIn(now, rules.timeZone);
  const lastDay = addDays(today, rules.maxDaysAhead);
  const earliest = now + rules.minNoticeMinutes * 60_000;
  const step = rules.intervalMinutes ?? rules.durationMinutes;
  const blocked = new Set(rules.blockedDates);
  const out = new Set<number>();
  let date = fromDate < today ? today : fromDate;
  const end = toDate > lastDay ? lastDay : toDate;
  for (let guard = 0; date <= end && guard < 400; guard += 1, date = addDays(date, 1)) {
    if (blocked.has(date)) continue;
    for (const window of rules.weekly.filter((w) => w.day === weekday(date))) {
      const close = window.end === "24:00" ? 24 * 60 : minutes(window.end);
      for (let m = minutes(window.start); m + rules.durationMinutes <= close; m += step) {
        const instant = instantOf(date, hhmm(m), rules.timeZone);
        if (instant !== null && instant >= earliest) out.add(instant);
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** The time a booking at `start` keeps its host busy, buffers included. */
export function blockedRange(rules: BookingRules, start: number): Interval {
  return {
    start: start - rules.bufferBeforeMinutes * 60_000,
    end: start + (rules.durationMinutes + rules.bufferAfterMinutes) * 60_000,
  };
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

export type Slot = { start: string; hostIds: string[] };

/** Slots with at least one free host. `busy` is each host's busy times
 * (their bookings' blocked ranges and their calendar's busy events). A
 * host missing from `busy` couldn't be checked, so isn't offered. */
export function availableSlots(
  rules: BookingRules,
  hostIds: string[],
  busy: Map<string, Interval[]>,
  starts: number[],
): Slot[] {
  const out: Slot[] = [];
  for (const start of starts) {
    const range = blockedRange(rules, start);
    const free = hostIds.filter(
      (h) => busy.has(h) && !busy.get(h)!.some((b) => overlaps(b, range)),
    );
    if (free.length) out.push({ start: new Date(start).toISOString(), hostIds: free });
  }
  return out;
}

/** Hosts in the order to try: fewest upcoming bookings first, so a team
 * shares the load; ties keep the given order. */
export function hostOrder(hostIds: string[], upcoming: Map<string, number>): string[] {
  return hostIds
    .map((id, i) => ({ id, i, n: upcoming.get(id) ?? 0 }))
    .sort((a, b) => a.n - b.n || a.i - b.i)
    .map((h) => h.id);
}

/** Whether an attendee may still cancel or move a booking themselves:
 * up to the booking type's minimum notice before it starts. */
export function attendeeMayChange(
  rules: Pick<BookingRules, "minNoticeMinutes">,
  startsAt: string,
  now = Date.now(),
) {
  return new Date(startsAt).getTime() - now >= rules.minNoticeMinutes * 60_000;
}

/** A Postgres timestamptz as text ("2026-11-03 05:00:00+00") → epoch ms. */
export function parsePgTimestamp(text: string): number {
  const normal = text
    .trim()
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/, "$1:00")
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return Date.parse(normal);
}

/** A Postgres tstzrange as text → interval. */
export function parsePgRange(range: string): Interval {
  const m = /^[[(]"?([^",]+)"?,"?([^")]+)"?[\])]$/.exec(range.trim());
  if (!m) return { start: 0, end: 0 };
  return { start: parsePgTimestamp(m[1]), end: parsePgTimestamp(m[2]) };
}
