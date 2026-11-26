import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { renderEmailHtml } from "@/domains/notifications/email-layout";
import { getWorkspacePlan } from "@/domains/billing/entitlements";
import {
  mergeContextFromResponse,
  templateForSend,
} from "@/domains/email-templates/queries";
import { renderForSend } from "@/domains/email-templates/send";
import { loadResponseContext } from "@/domains/responses/context";
import { cleanAddress, defaultSender, type Send } from "@/domains/notifications/mailer";
import { takeQuota } from "@/domains/billing/quotas";
import { workspaceEmailBrand } from "@/domains/notifications/branding";

type Client = SupabaseClient<Database>;

export type BookingEmailKind = "confirmed" | "cancelled" | "rescheduled" | "reminder";

/**
 * Booking emails (F-27): the attendee gets the time in their own zone,
 * a calendar file and their manage link (cancel or move, until the
 * booking type's minimum notice); the host gets a short note. The manage
 * token is only in the attendee's email — the database keeps its hash.
 */

function when(iso: string, timeZone: string | null) {
  const zone = timeZone || "UTC";
  try {
    return `${new Intl.DateTimeFormat("en-GB", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: zone,
    }).format(new Date(iso))} (${zone})`;
  } catch {
    return `${iso} (UTC)`;
  }
}

const icsDate = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
const icsText = (s: string) =>
  s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");

/** A one-event calendar file (RFC 5545). */
export function bookingIcs(input: {
  bookingId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location?: string | null;
  cancelled?: boolean;
  sequence?: number;
}): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FormCraft//Bookings//EN",
    `METHOD:${input.cancelled ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${input.bookingId}@formcraft`,
    `SEQUENCE:${input.sequence ?? 0}`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(input.startsAt)}`,
    `DTEND:${icsDate(input.endsAt)}`,
    `SUMMARY:${icsText(input.title)}`,
    ...(input.location ? [`LOCATION:${icsText(input.location)}`] : []),
    `STATUS:${input.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

const SUBJECT: Record<BookingEmailKind, string> = {
  confirmed: "Booked",
  cancelled: "Cancelled",
  rescheduled: "Moved",
  reminder: "Reminder",
};

export async function sendBookingEmails(
  admin: Client,
  bookingId: string,
  token: string | null,
  kind: BookingEmailKind,
  options: { send?: Send | null } = {},
): Promise<{ attendee: boolean; host: boolean }> {
  const send = options.send === undefined ? defaultSender() : options.send;
  const sent = { attendee: false, host: false };
  if (!send) return sent;
  const { data: b } = await admin
    .from("bookings")
    .select(
      "id, starts_at, ends_at, status, attendee_name, attendee_email, attendee_time_zone, booking_type_id, response_id, booking_types(name, location, time_zone, workspace_id), host:profiles!bookings_host_id_fkey(full_name, email)",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (!b) return sent;
  const type = b.booking_types as {
    name: string;
    location: string | null;
    time_zone: string;
    workspace_id: string;
  };
  const host = b.host as { full_name: string | null; email: string } | null;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const manage = token ? `${appUrl}/booking/${token}` : null;
  const cancelled = kind === "cancelled";
  const title = `${type.name}${host?.full_name ? ` with ${host.full_name}` : ""}`;
  const ics = bookingIcs({
    bookingId: b.id,
    title,
    startsAt: b.starts_at,
    endsAt: b.ends_at,
    location: type.location,
    cancelled,
    sequence: kind === "rescheduled" ? 1 : 0,
  });

  const { brand, fromName } = await workspaceEmailBrand(admin, type.workspace_id);
  const attendee = cleanAddress(b.attendee_email);
  // Each email counts against the workspace's monthly allowance. The
  // attendee's own confirmation, change and cancellation always go (they
  // need them); reminders and host emails stop when it's used up.
  if (
    attendee &&
    (await takeQuota(admin, type.workspace_id, "emails", 1, {
      countOnly: kind !== "reminder",
    }))
  ) {
    const time = when(b.starts_at, b.attendee_time_zone || type.time_zone);
    const body =
      kind === "cancelled"
        ? `Your ${type.name} on ${time} is cancelled.`
        : kind === "reminder"
          ? `A reminder: ${type.name} is on ${time}.`
          : `${kind === "rescheduled" ? "Moved to" : "You're booked for"} ${time}.`;
    const meta = [
      { label: "What", value: title },
      { label: "When", value: time },
      ...(type.location ? [{ label: "Where", value: type.location }] : []),
    ];
    // The booking type's own template (Starter and up) for confirmations
    // and reminders; changes and cancellations keep the standard email.
    const templateKind =
      kind === "reminder"
        ? ("booking_reminder" as const)
        : kind === "confirmed"
          ? ("booking_confirmation" as const)
          : null;
    const stored = templateKind
      ? await templateForSend(
          admin,
          type.workspace_id,
          { kind: templateKind, bookingTypeId: b.booking_type_id },
          (await getWorkspacePlan(admin, type.workspace_id)).entitlements,
        )
      : null;
    if (stored) {
      const ctx = b.response_id ? await loadResponseContext(admin, b.response_id) : null;
      const merge = ctx
        ? mergeContextFromResponse(ctx)
        : { formTitle: type.name, answers: {}, hidden: {}, answerLines: [] };
      const custom = await renderForSend(admin, {
        workspaceId: type.workspace_id,
        stored,
        merge: {
          ...merge,
          respondentEmail: merge.respondentEmail ?? attendee,
          booking: { type: type.name, time },
        },
        theme: ctx?.schema.theme,
        footerReason: "You're getting this because you booked through a form.",
      });
      const extra = manage
        ? {
            html: custom.html.replace(
              '</td></tr><tr><td style="padding:8px 32px 28px',
              `<p style="margin:0 0 14px;font-size:14px"><a href="${manage}">Change or cancel this booking</a></p></td></tr><tr><td style="padding:8px 32px 28px`,
            ),
            text: `${custom.text}\n\nChange or cancel: ${manage}`,
          }
        : {};
      const result = await send({
        to: [attendee],
        ...custom,
        ...extra,
        attachments: [
          { filename: "booking.ics", content: new TextEncoder().encode(ics) },
        ],
      });
      sent.attendee = result.ok;
    } else {
      const result = await send({
        to: [attendee],
        subject: `${SUBJECT[kind]}: ${type.name}`.slice(0, 200),
        fromName,
        html: renderEmailHtml({
          brand,
          tag: SUBJECT[kind],
          tagColor: cancelled ? "#f8e1dd" : "#dcf1e3",
          title: `${SUBJECT[kind]}: ${type.name}`,
          body,
          meta,
          ...(manage && !cancelled
            ? { button: { label: "Change or cancel", href: manage } }
            : {}),
          fine:
            manage && !cancelled
              ? "Keep this email: its link lets you move or cancel this booking."
              : "You booked this through a form.",
        }),
        text: [
          body,
          ...meta.map((m) => `${m.label}: ${m.value}`),
          ...(manage && !cancelled ? ["", `Change or cancel: ${manage}`] : []),
        ].join("\n"),
        attachments: [
          { filename: "booking.ics", content: new TextEncoder().encode(ics) },
        ],
      });
      sent.attendee = result.ok;
    }
  }

  const hostEmail = cleanAddress(host?.email);
  if (
    hostEmail &&
    kind !== "reminder" &&
    (await takeQuota(admin, type.workspace_id, "emails"))
  ) {
    const time = when(b.starts_at, type.time_zone);
    const who = b.attendee_name || b.attendee_email || "Someone";
    const result = await send({
      to: [hostEmail],
      subject: `${SUBJECT[kind]}: ${type.name} with ${who}`.slice(0, 200),
      fromName,
      html: renderEmailHtml({
        brand,
        tag: SUBJECT[kind],
        tagColor: cancelled ? "#f8e1dd" : "#e4ecfb",
        title: `${type.name} with ${who}`,
        body: `${SUBJECT[kind]} for ${time}.`,
        fine: "You're a host of this booking type.",
      }),
      text: `${type.name} with ${who}: ${SUBJECT[kind].toLowerCase()} for ${time}.`,
      attachments: [{ filename: "booking.ics", content: new TextEncoder().encode(ics) }],
    });
    sent.host = result.ok;
  }
  return sent;
}

/** Reminders a day ahead, once each (claimed before sending). */
export async function sendDueReminders(
  admin: Client,
  options: { now?: Date; send?: Send | null } = {},
): Promise<number> {
  const now = (options.now ?? new Date()).getTime();
  const { data } = await admin
    .from("bookings")
    .select("id, booking_types!inner(reminders)")
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .eq("booking_types.reminders", true)
    .gt("starts_at", new Date(now).toISOString())
    .lte("starts_at", new Date(now + 24 * 3_600_000).toISOString())
    .limit(200);
  let sent = 0;
  for (const b of data ?? []) {
    const { data: claimed } = await admin
      .from("bookings")
      .update({ reminder_sent_at: new Date(now).toISOString() })
      .eq("id", b.id)
      .is("reminder_sent_at", null)
      .select("id");
    if (!claimed?.length) continue;
    const result = await sendBookingEmails(admin, b.id, null, "reminder", options);
    if (result.attendee) sent += 1;
  }
  return sent;
}
