"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { canEdit } from "@/domains/workspaces";
import { createAdminClient } from "@/lib/supabase/admin";
import { BookingRules, WeeklyWindow } from "@/domains/bookings/availability";
import { cancelBooking } from "@/domains/bookings/server";
import { sendBookingEmails } from "@/domains/bookings/emails";
import "@/domains/connectors/registry";
import {
  dispatchConnectorJobs,
  findConnection,
  revokeConnection,
  updateConnectionSettings,
} from "@/domains/connectors/framework";
import { listCalendars } from "@/domains/bookings/google-calendar";
import type { Json } from "@/lib/supabase/database.types";

type Result = { ok: true; id?: string } | { ok: false; message: string };

/** Booking types for the builder's booking question (members read). */
export async function listBookingTypesAction(): Promise<{ id: string; name: string }[]> {
  const { supabase, workspace } = await getCurrentWorkspace();
  const { data } = await supabase
    .from("booking_types")
    .select("id, name")
    .eq("workspace_id", workspace.id)
    .is("archived_at", null)
    .order("name");
  return data ?? [];
}

const TypeInput = z.object({
  name: z.string().trim().min(1, "Name it.").max(120),
  durationMinutes: z.number().int().min(5).max(480),
  intervalMinutes: z.number().int().min(5).max(480).nullable(),
  bufferBeforeMinutes: z.number().int().min(0).max(240),
  bufferAfterMinutes: z.number().int().min(0).max(240),
  minNoticeMinutes: z.number().int().min(0).max(20160),
  maxDaysAhead: z.number().int().min(1).max(365),
  timeZone: z.string(),
  weekly: z.array(WeeklyWindow).max(50),
  blockedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366),
  location: z.string().trim().max(500).nullable(),
  reminders: z.boolean(),
  hostIds: z.array(z.string().uuid()).min(1, "Choose at least one host.").max(20),
});
export type BookingTypeInput = z.input<typeof TypeInput>;

/**
 * Creates or changes a booking type (F-27). Editors and up; hosts must be
 * members of the workspace. Changing hours never touches existing
 * bookings.
 */
export async function saveBookingTypeAction(
  id: string | null,
  input: BookingTypeInput,
): Promise<Result> {
  const parsed = TypeInput.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  const rules = BookingRules.safeParse({ ...parsed.data });
  if (!rules.success)
    return { ok: false, message: rules.error.issues[0]?.message ?? "Check the hours." };
  const { supabase, workspace, user } = await getCurrentWorkspace();
  if (!canEdit(workspace.role))
    return { ok: false, message: "You have view-only access." };
  const { data: roster } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspace.id);
  const allMembers = new Set((roster ?? []).map((r) => r.user_id));
  if (parsed.data.hostIds.some((h) => !allMembers.has(h))) {
    return { ok: false, message: "Hosts must be members of this workspace." };
  }
  const row = {
    workspace_id: workspace.id,
    name: parsed.data.name,
    duration_minutes: parsed.data.durationMinutes,
    interval_minutes: parsed.data.intervalMinutes,
    buffer_before_minutes: parsed.data.bufferBeforeMinutes,
    buffer_after_minutes: parsed.data.bufferAfterMinutes,
    min_notice_minutes: parsed.data.minNoticeMinutes,
    max_days_ahead: parsed.data.maxDaysAhead,
    time_zone: parsed.data.timeZone,
    weekly: parsed.data.weekly as unknown as Json,
    blocked_dates: parsed.data.blockedDates,
    location: parsed.data.location || null,
    reminders: parsed.data.reminders,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = id
    ? await supabase
        .from("booking_types")
        .update(row)
        .eq("id", id)
        .eq("workspace_id", workspace.id)
        .select("id")
        .single()
    : await supabase
        .from("booking_types")
        .insert({ ...row, created_by: user.id })
        .select("id")
        .single();
  if (error || !data) return { ok: false, message: "Couldn't save. Please try again." };
  await supabase.from("booking_hosts").delete().eq("booking_type_id", data.id);
  const { error: hostError } = await supabase
    .from("booking_hosts")
    .insert(
      parsed.data.hostIds.map((user_id) => ({ booking_type_id: data.id, user_id })),
    );
  if (hostError) return { ok: false, message: "Couldn't save the hosts." };
  revalidatePath("/bookings");
  return { ok: true, id: data.id };
}

export async function archiveBookingTypeAction(id: string): Promise<Result> {
  const { supabase, workspace } = await getCurrentWorkspace();
  if (!canEdit(workspace.role))
    return { ok: false, message: "You have view-only access." };
  const { error } = await supabase
    .from("booking_types")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", workspace.id);
  if (error) return { ok: false, message: "Couldn't archive it." };
  revalidatePath("/bookings");
  return { ok: true };
}

/** A host or an editor cancels a booking; the attendee is told. */
export async function cancelBookingAction(bookingId: string): Promise<Result> {
  if (!z.string().uuid().safeParse(bookingId).success)
    return { ok: false, message: "Not found." };
  const { supabase, workspace, user } = await getCurrentWorkspace();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, host_id, booking_types!inner(workspace_id)")
    .eq("id", bookingId)
    .eq("booking_types.workspace_id", workspace.id)
    .maybeSingle();
  if (!booking) return { ok: false, message: "Not found." };
  if (booking.host_id !== user.id && !canEdit(workspace.role)) {
    return { ok: false, message: "Only the host or an editor can cancel it." };
  }
  const admin = createAdminClient();
  if (!(await cancelBooking(admin, bookingId, "host")))
    return { ok: false, message: "It's already cancelled." };
  await sendBookingEmails(admin, bookingId, null, "cancelled").catch(() => null);
  await dispatchConnectorJobs(admin).catch(() => null);
  revalidatePath("/bookings");
  return { ok: true };
}

/** Which of your calendars bookings use (your own connection only). */
export async function chooseCalendarAction(calendarId: string): Promise<Result> {
  const { workspace, user } = await getCurrentWorkspace();
  const admin = createAdminClient();
  const connection = await findConnection(
    admin,
    workspace.id,
    "google_calendar",
    user.id,
  );
  if (!connection) return { ok: false, message: "Connect Google Calendar first." };
  const calendars = await listCalendars(admin, connection).catch(() => []);
  if (!calendars.some((c) => c.id === calendarId))
    return { ok: false, message: "Pick one of your calendars." };
  await updateConnectionSettings(admin, connection.id, {
    ...connection.settings,
    calendarId,
  });
  revalidatePath("/bookings");
  return { ok: true };
}

export async function disconnectCalendarAction(): Promise<Result> {
  const { workspace, user } = await getCurrentWorkspace();
  const admin = createAdminClient();
  const connection = await findConnection(
    admin,
    workspace.id,
    "google_calendar",
    user.id,
  );
  if (!connection) return { ok: true };
  await revokeConnection(admin, connection.id);
  await admin.from("connector_connections").delete().eq("id", connection.id);
  revalidatePath("/bookings");
  return { ok: true };
}
