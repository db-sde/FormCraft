import { z } from "zod";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hitRateLimit } from "@/domains/abuse";
import {
  bookingByToken,
  cancelBooking,
  confirmBooking,
  loadBookingType,
  reserveSlot,
  slotsBetween,
} from "@/domains/bookings/server";
import { attendeeMayChange } from "@/domains/bookings/availability";
import { sendBookingEmails } from "@/domains/bookings/emails";
import "@/domains/connectors/registry";
import { dispatchConnectorJobs } from "@/domains/connectors/framework";
import { apiError, getClientIp } from "../../responses/shared";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("slots"),
    token: z.string(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({ action: z.literal("cancel"), token: z.string() }),
  z.object({
    action: z.literal("reschedule"),
    token: z.string(),
    start: z.string().datetime(),
  }),
]);

function addDays(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The attendee's manage link (F-27): see free times, cancel, or move to
 * another time — with the token from their email only, and only until
 * the booking type's minimum notice. Moving takes the new slot first
 * (atomically) and then releases the old one, so they never end up with
 * neither.
 */
export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("invalid_body", "Invalid request.", 400);
  const admin = createAdminClient();
  const limited = await hitRateLimit(
    admin,
    `manage:${getClientIp(request)}`,
    60,
    10 * 60 * 1000,
  );
  if (!limited.allowed) return apiError("rate_limited", "Too many requests.", 429);
  const booking = await bookingByToken(admin, parsed.data.token);
  if (!booking) return apiError("not_found", "That link doesn't match a booking.", 404);
  const type = await loadBookingType(admin, booking.booking_type_id);
  if (!type) return apiError("not_found", "That booking type is gone.", 404);
  if (booking.status !== "confirmed") {
    return apiError("not_confirmed", "This booking isn't active.", 409);
  }
  if (!attendeeMayChange(type.rules, booking.starts_at)) {
    return apiError(
      "too_late",
      "It's too close to the time to change this booking online. Contact the host.",
      409,
    );
  }

  switch (parsed.data.action) {
    case "slots": {
      const slots = await slotsBetween(
        admin,
        type,
        parsed.data.from,
        addDays(parsed.data.from, 6),
      );
      return NextResponse.json({
        timeZone: type.rules.timeZone,
        slots: slots.map((s) => s.start),
      });
    }
    case "cancel": {
      await cancelBooking(admin, booking.id, "attendee");
      await sendBookingEmails(admin, booking.id, null, "cancelled").catch(() => null);
      await dispatchConnectorJobs(admin, { bookingId: booking.id }).catch(() => null);
      return NextResponse.json({ ok: true });
    }
    case "reschedule": {
      if (!booking.form_id || !booking.response_id) {
        return apiError(
          "unavailable",
          "This booking can't be moved online. Contact the host.",
          409,
        );
      }
      const moved = await reserveSlot(admin, {
        type,
        start: parsed.data.start,
        formId: booking.form_id,
        responseId: booking.response_id,
        attendee: {
          name: booking.attendee_name,
          email: booking.attendee_email,
          timeZone: booking.attendee_time_zone,
        },
        rescheduledFrom: booking.id,
      });
      if (!moved.ok) return apiError("slot_taken", moved.message, 409);
      await confirmBooking(admin, moved.bookingId, booking.response_id);
      await cancelBooking(admin, booking.id, "attendee");
      await sendBookingEmails(admin, moved.bookingId, moved.token, "rescheduled").catch(
        () => null,
      );
      return NextResponse.json({
        ok: true,
        startsAt: moved.startsAt,
        token: moved.token,
      });
    }
  }
}
