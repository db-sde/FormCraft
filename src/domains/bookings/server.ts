import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { findConnection, enqueueJob } from "@/domains/connectors/framework";
import { logResponseEvent } from "@/domains/responses/timeline";
import {
  availableSlots,
  BookingRules,
  blockedRange,
  candidateStarts,
  dateIn,
  parsePgRange,
  hostOrder,
  type Interval,
  type Slot,
} from "./availability";
import { calendarBusy } from "./google-calendar";

type Client = SupabaseClient<Database>;

/**
 * Native bookings (master spec F-27), on the server. Product decisions
 * (2026-11-02, the spec's §9 items 1–2 left to the defaults recorded in
 * DECISIONS.md): Outlook waits for the Microsoft 365 work (F-39); each
 * host connects their own Google Calendar; any free host may take a
 * booking (fewest upcoming first); one reminder a day before; attendees
 * change or cancel up to the minimum notice; a calendar that can't be
 * read hides that host's times rather than risk a double booking.
 *
 * Booking at submit is two steps around the response: a slot is held
 * (status pending) before the response completes — the database refuses
 * overlaps — then confirmed once it has. If the response doesn't
 * complete, the hold is released (and unconfirmed holds lapse after 15
 * minutes anyway), so there's never a confirmed booking without its
 * response or a response promising a slot that wasn't taken.
 */

export type BookingType = {
  id: string;
  workspaceId: string;
  name: string;
  rules: BookingRules;
  location: string | null;
  reminders: boolean;
  hostIds: string[];
  archived: boolean;
};

const PENDING_HOLD_MINUTES = 15;

export async function loadBookingType(
  admin: Client,
  id: string,
): Promise<BookingType | null> {
  const { data } = await admin
    .from("booking_types")
    .select("*, booking_hosts(user_id)")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const rules = BookingRules.safeParse({
    durationMinutes: data.duration_minutes,
    intervalMinutes: data.interval_minutes,
    bufferBeforeMinutes: data.buffer_before_minutes,
    bufferAfterMinutes: data.buffer_after_minutes,
    minNoticeMinutes: data.min_notice_minutes,
    maxDaysAhead: data.max_days_ahead,
    timeZone: data.time_zone,
    weekly: data.weekly,
    blockedDates: data.blocked_dates,
  });
  if (!rules.success) return null;
  return {
    id: data.id,
    workspaceId: data.workspace_id,
    name: data.name,
    rules: rules.data,
    location: data.location,
    reminders: data.reminders,
    hostIds: ((data.booking_hosts ?? []) as { user_id: string }[]).map((h) => h.user_id),
    archived: data.archived_at !== null,
  };
}

/** Each host's busy times in a window: their live bookings (any booking
 * type — a person can't be in two places) and, when connected, their
 * calendar's busy events. A host whose calendar can't be read is left
 * out, so their times aren't offered. */
export async function busyTimes(
  admin: Client,
  type: BookingType,
  window: Interval,
  options: { fetch?: typeof fetch; skipCalendar?: boolean } = {},
): Promise<Map<string, Interval[]>> {
  const busy = new Map<string, Interval[]>(type.hostIds.map((h) => [h, []]));
  if (type.hostIds.length === 0) return busy;
  const holdSince = new Date(Date.now() - PENDING_HOLD_MINUTES * 60_000).toISOString();
  const { data } = await admin
    .from("bookings")
    .select("host_id, starts_at, ends_at, blocked, status, created_at")
    .in("host_id", type.hostIds)
    .in("status", ["pending", "confirmed"])
    .lt("starts_at", new Date(window.end + 86_400_000).toISOString())
    .gt("ends_at", new Date(window.start - 86_400_000).toISOString());
  for (const b of data ?? []) {
    if (b.status === "pending" && b.created_at < holdSince) continue;
    busy.get(b.host_id)?.push(parseRange(b.blocked as string));
  }
  if (!options.skipCalendar) {
    await Promise.all(
      type.hostIds.map(async (host) => {
        const connection = await findConnection(
          admin,
          type.workspaceId,
          "google_calendar",
          host,
        );
        if (!connection) return;
        const events =
          connection.status === "ok"
            ? await calendarBusy(admin, connection, window, options.fetch).catch(
                () => null,
              )
            : null;
        if (events === null) busy.delete(host);
        else busy.get(host)?.push(...events);
      }),
    );
  }
  return busy;
}

/** Postgres range text → interval: `["2026-11-03 14:00:00+00","…")`. */
export const parseRange = parsePgRange;

/** Slots between two local dates (the booking type's zone). */
export async function slotsBetween(
  admin: Client,
  type: BookingType,
  fromDate: string,
  toDate: string,
  options: { now?: number; fetch?: typeof fetch } = {},
): Promise<Slot[]> {
  if (type.archived) return [];
  const now = options.now ?? Date.now();
  const starts = candidateStarts(type.rules, fromDate, toDate, now);
  if (starts.length === 0) return [];
  const window = {
    start: blockedRange(type.rules, starts[0]).start,
    end: blockedRange(type.rules, starts[starts.length - 1]).end,
  };
  const busy = await busyTimes(admin, type, window, options);
  return availableSlots(type.rules, type.hostIds, busy, starts);
}

export function newManageToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export type ReserveResult =
  | {
      ok: true;
      bookingId: string;
      hostId: string;
      startsAt: string;
      endsAt: string;
      token: string;
    }
  | { ok: false; message: string };

/**
 * Holds a slot for a response: checks it's offered right now (rules,
 * notice, horizon, every host's busy times) and takes it for the first
 * free host in load order, atomically. Idempotent per response: a
 * repeat returns the booking already held or confirmed for it.
 */
export async function reserveSlot(
  admin: Client,
  input: {
    type: BookingType;
    start: string;
    formId: string;
    responseId: string;
    attendee: { name: string | null; email: string | null; timeZone: string | null };
    rescheduledFrom?: string;
  },
  options: { now?: number; fetch?: typeof fetch } = {},
): Promise<ReserveResult & { existing?: boolean }> {
  if (!input.rescheduledFrom) {
    const { data: held } = await admin
      .from("bookings")
      .select("id, host_id, starts_at, ends_at, status")
      .eq("response_id", input.responseId)
      .in("status", ["pending", "confirmed"])
      .maybeSingle();
    if (held) {
      return {
        ok: true,
        existing: true,
        bookingId: held.id,
        hostId: held.host_id,
        startsAt: held.starts_at,
        endsAt: held.ends_at,
        token: "",
      };
    }
  }
  const start = Date.parse(input.start);
  if (!Number.isFinite(start)) return { ok: false, message: "Pick a time." };
  const tz = input.type.rules.timeZone;
  const day = dateIn(start, tz);
  const slots = await slotsBetween(admin, input.type, day, day, options);
  const slot = slots.find((s) => Date.parse(s.start) === start);
  if (!slot) {
    return { ok: false, message: "That time isn't available any more. Pick another." };
  }
  const upcoming = new Map<string, number>();
  const { data: counts } = await admin
    .from("bookings")
    .select("host_id")
    .in("host_id", slot.hostIds)
    .eq("status", "confirmed")
    .gt("starts_at", new Date().toISOString());
  for (const c of counts ?? [])
    upcoming.set(c.host_id, (upcoming.get(c.host_id) ?? 0) + 1);
  const { token, hash } = newManageToken();
  const { data, error } = await admin.rpc("book_slot", {
    p_booking_type_id: input.type.id,
    p_host_ids: hostOrder(slot.hostIds, upcoming),
    p_starts_at: new Date(start).toISOString(),
    p_form_id: input.formId,
    p_response_id: input.responseId,
    p_attendee_name: input.attendee.name ?? "",
    p_attendee_email: input.attendee.email ?? "",
    p_attendee_time_zone: input.attendee.timeZone ?? "",
    p_manage_token_hash: hash,
    ...(input.rescheduledFrom ? { p_rescheduled_from: input.rescheduledFrom } : {}),
  });
  const row = data?.[0];
  if (error || !row) {
    return { ok: false, message: "That time was just taken. Pick another." };
  }
  return {
    ok: true,
    bookingId: row.id,
    hostId: row.host_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    token,
  };
}

/** Confirms a held booking once its response is in, and queues the
 * host's calendar event. */
export async function confirmBooking(
  admin: Client,
  bookingId: string,
  responseId: string | null,
) {
  const { data } = await admin
    .from("bookings")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
    .eq("id", bookingId)
    .eq("status", "pending")
    .select("id, host_id, booking_type_id, booking_types(workspace_id)")
    .maybeSingle();
  if (!data) return false;
  const workspaceId = (data.booking_types as { workspace_id: string }).workspace_id;
  if (responseId) {
    await logResponseEvent(admin, {
      responseId,
      kind: "booking",
      detail: { action: "confirmed", booking: bookingId },
    });
  }
  await queueCalendarSync(admin, workspaceId, data.host_id, bookingId, "create_event");
  return true;
}

/** Releases a hold whose response didn't complete. */
export async function releaseHold(admin: Client, bookingId: string) {
  await admin
    .from("bookings")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: "system",
    })
    .eq("id", bookingId)
    .eq("status", "pending");
}

export async function cancelBooking(
  admin: Client,
  bookingId: string,
  by: "attendee" | "host" | "calendar" | "system",
): Promise<boolean> {
  const { data } = await admin
    .from("bookings")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: by,
    })
    .eq("id", bookingId)
    .in("status", ["pending", "confirmed"])
    .select("id, host_id, response_id, booking_types(workspace_id)")
    .maybeSingle();
  if (!data) return false;
  if (data.response_id) {
    await logResponseEvent(admin, {
      responseId: data.response_id,
      kind: "booking",
      detail: { action: "cancelled", by, booking: bookingId },
    });
  }
  if (by !== "calendar") {
    await queueCalendarSync(
      admin,
      (data.booking_types as { workspace_id: string }).workspace_id,
      data.host_id,
      bookingId,
      "delete_event",
    );
  }
  return true;
}

async function queueCalendarSync(
  admin: Client,
  workspaceId: string,
  hostId: string,
  bookingId: string,
  action: "create_event" | "delete_event",
) {
  const connection = await findConnection(admin, workspaceId, "google_calendar", hostId);
  if (!connection || connection.status !== "ok") return;
  await enqueueJob(admin, {
    connectionId: connection.id,
    workspaceId,
    provider: "google_calendar",
    action,
    idempotencyKey: `gcal:${action}:${bookingId}`,
    bookingId,
  });
}

/** A booking from its manage-link token (the attendee's page). */
export async function bookingByToken(admin: Client, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { data } = await admin
    .from("bookings")
    .select(
      "id, booking_type_id, host_id, form_id, response_id, starts_at, ends_at, status, attendee_name, attendee_email, attendee_time_zone, booking_types(name, location, time_zone, min_notice_minutes), host:profiles!bookings_host_id_fkey(full_name, email)",
    )
    .eq("manage_token_hash", hashToken(token))
    .maybeSingle();
  return data;
}
