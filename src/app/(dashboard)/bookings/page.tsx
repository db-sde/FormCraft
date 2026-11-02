import type { Metadata } from "next";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { canEdit } from "@/domains/workspaces";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadBookingType } from "@/domains/bookings/server";
import { findConnection } from "@/domains/connectors/framework";
import { isConfigured } from "@/domains/connectors/oauth";
import { calendarIdOf, listCalendars } from "@/domains/bookings/google-calendar";
import { BookingsManager } from "@/components/bookings/bookings-manager";

export const metadata: Metadata = { title: "Bookings" };

const ERRORS: Record<string, string> = {
  not_configured: "Google Calendar isn't set up on this server yet.",
  declined: "Google Calendar wasn't connected: access was declined.",
  expired: "That took too long. Try connecting again.",
  exchange_failed: "Google Calendar couldn't be connected. Try again.",
  forbidden: "You don't have permission to connect that.",
};

/** Native bookings (F-27): booking types, upcoming bookings, and your
 * own calendar connection (F-43). */
export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connect_error?: string; connected?: string }>;
}) {
  const sp = await searchParams;
  const { supabase, workspace, user } = await getCurrentWorkspace();
  const admin = createAdminClient();
  const [{ data: types }, { data: members }, { data: bookings }, connection] =
    await Promise.all([
      supabase
        .from("booking_types")
        .select("id")
        .eq("workspace_id", workspace.id)
        .is("archived_at", null)
        .order("created_at"),
      supabase
        .from("workspace_members")
        .select("user_id, profiles(full_name, email)")
        .eq("workspace_id", workspace.id),
      supabase
        .from("bookings")
        .select(
          "id, starts_at, ends_at, status, attendee_name, attendee_email, host_id, booking_types!inner(name, workspace_id)",
        )
        .eq("booking_types.workspace_id", workspace.id)
        .eq("status", "confirmed")
        .gt("ends_at", new Date().toISOString())
        .order("starts_at")
        .limit(50),
      findConnection(admin, workspace.id, "google_calendar", user.id),
    ]);
  const loaded = (
    await Promise.all((types ?? []).map((t) => loadBookingType(admin, t.id)))
  ).filter((t): t is NonNullable<typeof t> => t !== null);
  const people = (members ?? []).map((m) => {
    const p = m.profiles as { full_name: string | null; email: string } | null;
    return { id: m.user_id, name: p?.full_name || p?.email || "Teammate" };
  });
  const calendars =
    connection && connection.status === "ok"
      ? await listCalendars(admin, connection).catch(() => [])
      : [];

  return (
    <div className="flex flex-col gap-[22px]">
      <div>
        <h1 className="font-heading text-[38px] leading-none font-bold tracking-[-0.03em] sm:text-[56px]">
          Bookings
        </h1>
        <p className="text-muted-foreground mt-2.5 max-w-2xl text-[15px]">
          Let people book a time in a form. Set hosts and hours here, then add a Booking
          question to a form. Each host can connect their Google Calendar so busy times
          are skipped and bookings land in it.
        </p>
      </div>
      {sp.connect_error && (
        <p
          role="alert"
          className="rounded-sm bg-[var(--alert-warning-bg)] px-3 py-2 text-sm text-[var(--alert-warning-fg)]"
        >
          {ERRORS[sp.connect_error] ?? "That didn't connect. Try again."}
        </p>
      )}
      <BookingsManager
        canEdit={canEdit(workspace.role)}
        userId={user.id}
        types={loaded.map((t) => ({
          id: t.id,
          name: t.name,
          location: t.location,
          reminders: t.reminders,
          hostIds: t.hostIds,
          ...t.rules,
        }))}
        people={people}
        bookings={(bookings ?? []).map((b) => ({
          id: b.id,
          startsAt: b.starts_at,
          endsAt: b.ends_at,
          type: (b.booking_types as { name: string }).name,
          attendee: b.attendee_name || b.attendee_email || "Someone",
          host: people.find((p) => p.id === b.host_id)?.name ?? "A former teammate",
          mine: b.host_id === user.id,
        }))}
        calendar={{
          available: isConfigured("google_calendar"),
          connected: Boolean(connection),
          status: connection?.status ?? null,
          label: connection?.label ?? null,
          calendarId: connection ? calendarIdOf(connection) : null,
          calendars,
          justConnected: sp.connected === "google_calendar",
        }}
      />
    </div>
  );
}
