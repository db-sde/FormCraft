import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  getConnection,
  providerCall,
  registerAction,
  usableTokens,
  type Connection,
} from "@/domains/connectors/framework";
import { logResponseEvent } from "@/domains/responses/timeline";
import { parsePgRange, type Interval } from "./availability";

type Client = SupabaseClient<Database>;

/**
 * Google Calendar for bookings (master spec F-43), one module inside the
 * booking engine — not a second scheduler. Each host connects their own
 * calendar (OAuth, least scopes: events, free/busy, calendar list).
 *
 * - Busy times on their chosen calendar block offers (free/busy API).
 * - Events are created with an id derived from the booking, so a retried
 *   or replayed create can't make a second event (Google answers 409,
 *   which counts as done); invitations go to the attendee.
 * - Cancelling in FormCraft deletes the event; deleting or moving the
 *   event in Google is picked up by `syncCalendarBookings` (polled by the
 *   connectors cron): a deleted event cancels the booking; a moved one
 *   moves it if the host is free then, and otherwise stays put with a
 *   note on the response's timeline.
 */

const API = "https://www.googleapis.com/calendar/v3";

export function calendarIdOf(connection: Connection): string {
  const id = connection.settings.calendarId;
  return typeof id === "string" && id ? id : "primary";
}

/** Google event ids are base32hex (0-9, a-v), 5–1024 characters. */
export function eventIdFor(bookingId: string): string {
  return `fc${bookingId.replace(/-/g, "").toLowerCase()}`;
}

export async function calendarBusy(
  admin: Client,
  connection: Connection,
  window: Interval,
  fetcher: typeof fetch = fetch,
): Promise<Interval[]> {
  const tokens = await usableTokens(admin, connection, fetcher);
  const calendarId = calendarIdOf(connection);
  const res = await providerCall(fetcher, `${API}/freeBusy`, {
    method: "POST",
    token: tokens.accessToken,
    body: JSON.stringify({
      timeMin: new Date(window.start).toISOString(),
      timeMax: new Date(window.end).toISOString(),
      items: [{ id: calendarId }],
    }),
  });
  if (!res.ok) throw new Error("free/busy lookup failed");
  const calendars =
    (
      res.data as {
        calendars?: Record<
          string,
          { busy?: { start: string; end: string }[]; errors?: unknown[] }
        >;
      }
    ).calendars ?? {};
  const entry = calendars[calendarId];
  if (!entry || entry.errors?.length) throw new Error("calendar not readable");
  return (entry.busy ?? []).map((b) => ({
    start: Date.parse(b.start),
    end: Date.parse(b.end),
  }));
}

/** The connection's calendars, for choosing which one bookings use. */
export async function listCalendars(
  admin: Client,
  connection: Connection,
  fetcher: typeof fetch = fetch,
): Promise<{ id: string; name: string; primary: boolean }[]> {
  const tokens = await usableTokens(admin, connection, fetcher);
  const res = await providerCall(
    fetcher,
    `${API}/users/me/calendarList?minAccessRole=writer`,
    {
      token: tokens.accessToken,
    },
  );
  if (!res.ok) return [];
  return (
    (res.data as { items?: { id: string; summary?: string; primary?: boolean }[] })
      .items ?? []
  ).map((c) => ({ id: c.id, name: c.summary ?? c.id, primary: Boolean(c.primary) }));
}

async function bookingForEvent(admin: Client, bookingId: string) {
  const { data } = await admin
    .from("bookings")
    .select(
      "id, starts_at, ends_at, status, attendee_name, attendee_email, booking_types(name, location)",
    )
    .eq("id", bookingId)
    .maybeSingle();
  return data;
}

registerAction("google_calendar", "create_event", async (job, ctx) => {
  if (!job.booking_id) return { ok: false, retry: false, error: "No booking" };
  const booking = await bookingForEvent(ctx.admin, job.booking_id);
  if (!booking || booking.status !== "confirmed")
    return { ok: true, result: { skipped: true } };
  const type = booking.booking_types as { name: string; location: string | null };
  const calendarId = encodeURIComponent(calendarIdOf(ctx.connection));
  const res = await providerCall(
    ctx.fetch,
    `${API}/calendars/${calendarId}/events?sendUpdates=all`,
    {
      method: "POST",
      token: ctx.connection.tokens.accessToken,
      body: JSON.stringify({
        id: eventIdFor(booking.id),
        summary: `${type.name}${booking.attendee_name ? ` with ${booking.attendee_name}` : ""}`,
        ...(type.location ? { location: type.location } : {}),
        description: "Booked with FormCraft.",
        start: { dateTime: booking.starts_at },
        end: { dateTime: booking.ends_at },
        ...(booking.attendee_email
          ? { attendees: [{ email: booking.attendee_email }] }
          : {}),
      }),
    },
  );
  if (res.ok) return { ok: true, result: { eventId: eventIdFor(booking.id) } };
  // Already created by an earlier attempt: the same event.
  if (!res.ok && res.result.ok === false && /HTTP 409/.test(res.result.error)) {
    return { ok: true, result: { eventId: eventIdFor(booking.id), existed: true } };
  }
  return res.result;
});

registerAction("google_calendar", "delete_event", async (job, ctx) => {
  if (!job.booking_id) return { ok: false, retry: false, error: "No booking" };
  const calendarId = encodeURIComponent(calendarIdOf(ctx.connection));
  const res = await providerCall(
    ctx.fetch,
    `${API}/calendars/${calendarId}/events/${eventIdFor(job.booking_id)}?sendUpdates=all`,
    { method: "DELETE", token: ctx.connection.tokens.accessToken },
  );
  if (res.ok) return { ok: true };
  // Already gone (deleted in Google, or never created): nothing to do.
  if (res.result.ok === false && /HTTP (404|410)/.test(res.result.error))
    return { ok: true };
  return res.result;
});

/**
 * Picks up changes made in Google: for confirmed, upcoming bookings
 * whose event exists, a cancelled or deleted event cancels the booking;
 * a moved event moves the booking if the host is free then (the
 * database's overlap rule decides), otherwise a note is left.
 */
export async function syncCalendarBookings(
  admin: Client,
  options: {
    fetch?: typeof fetch;
    limit?: number;
    onCancelled?: (bookingId: string) => Promise<void>;
  } = {},
): Promise<{ checked: number; cancelled: number; moved: number }> {
  const fetcher = options.fetch ?? fetch;
  const { data: jobs } = await admin
    .from("connector_jobs")
    .select(
      "booking_id, connection_id, bookings!inner(id, status, starts_at, ends_at, response_id, blocked)",
    )
    .eq("provider", "google_calendar")
    .eq("action", "create_event")
    .eq("status", "succeeded")
    .eq("bookings.status", "confirmed")
    .gt("bookings.starts_at", new Date().toISOString())
    .limit(options.limit ?? 200);
  let cancelled = 0;
  let moved = 0;
  const connections = new Map<string, Connection | null>();
  for (const job of jobs ?? []) {
    if (!job.booking_id || !job.connection_id) continue;
    if (!connections.has(job.connection_id)) {
      connections.set(job.connection_id, await getConnection(admin, job.connection_id));
    }
    const connection = connections.get(job.connection_id);
    if (!connection || connection.status !== "ok") continue;
    const booking = job.bookings as {
      id: string;
      starts_at: string;
      ends_at: string;
      response_id: string | null;
      blocked: string;
    };
    let tokens;
    try {
      tokens = await usableTokens(admin, connection, fetcher);
    } catch {
      continue;
    }
    const res = await providerCall(
      fetcher,
      `${API}/calendars/${encodeURIComponent(calendarIdOf(connection))}/events/${eventIdFor(booking.id)}`,
      { token: tokens.accessToken },
    );
    const gone =
      !res.ok && res.result.ok === false && /HTTP (404|410)/.test(res.result.error);
    const event = res.ok
      ? (res.data as {
          status?: string;
          start?: { dateTime?: string };
          end?: { dateTime?: string };
        })
      : null;
    if (gone || event?.status === "cancelled") {
      const { data: done } = await admin
        .from("bookings")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancelled_by: "calendar",
        })
        .eq("id", booking.id)
        .eq("status", "confirmed")
        .select("id");
      if (done?.length) {
        cancelled += 1;
        if (booking.response_id) {
          await logResponseEvent(admin, {
            responseId: booking.response_id,
            kind: "booking",
            detail: { action: "cancelled", by: "calendar", booking: booking.id },
          });
        }
        await options.onCancelled?.(booking.id);
      }
      continue;
    }
    const start = event?.start?.dateTime ? Date.parse(event.start.dateTime) : NaN;
    const end = event?.end?.dateTime ? Date.parse(event.end.dateTime) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start === Date.parse(booking.starts_at) && end === Date.parse(booking.ends_at))
      continue;
    // Moved in Google: keep the buffers, move the block.
    const oldStart = Date.parse(booking.starts_at);
    const oldEnd = Date.parse(booking.ends_at);
    const [blockStart, blockEnd] = rangeBounds(booking.blocked);
    const before = oldStart - blockStart;
    const after = blockEnd - oldEnd;
    const { error } = await admin
      .from("bookings")
      .update({
        starts_at: new Date(start).toISOString(),
        ends_at: new Date(end).toISOString(),
        blocked: `[${new Date(start - before).toISOString()},${new Date(end + after).toISOString()})`,
      })
      .eq("id", booking.id)
      .eq("status", "confirmed");
    if (booking.response_id) {
      await logResponseEvent(admin, {
        responseId: booking.response_id,
        kind: "booking",
        outcome: error ? "failed" : "ok",
        detail: error
          ? {
              action: "move_refused",
              booking: booking.id,
              reason:
                "Moved in Google Calendar onto another booking; kept the original time",
            }
          : {
              action: "moved",
              by: "calendar",
              booking: booking.id,
              to: new Date(start).toISOString(),
            },
      });
    }
    if (!error) moved += 1;
  }
  return { checked: jobs?.length ?? 0, cancelled, moved };
}

function rangeBounds(range: string): [number, number] {
  const r = parsePgRange(range);
  return [r.start, r.end];
}
