import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectUnlessCron } from "@/lib/http/cron-auth";
import "@/domains/connectors/registry";
import { dispatchConnectorJobs } from "@/domains/connectors/framework";
import { recoverMissingConnectorSyncs } from "@/domains/connectors/links";
import { syncCalendarBookings } from "@/domains/bookings/google-calendar";
import { sendBookingEmails, sendDueReminders } from "@/domains/bookings/emails";

// A batch of background work: bounded explicitly (seconds).
export const maxDuration = 60;

/**
 * The connectors worker (spec §5.3): runs due connector jobs (calendar
 * events, app records), queues syncs a killed request missed, sends booking reminders, and
 * picks up bookings deleted or moved in Google Calendar. CRON_SECRET.
 */
async function run(request: NextRequest) {
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;
  const admin = createAdminClient();
  const recovered = await recoverMissingConnectorSyncs(admin).catch(() => ({
    recovered: 0,
  }));
  const jobs = await dispatchConnectorJobs(admin);
  const reminders = await sendDueReminders(admin);
  const calendar = await syncCalendarBookings(admin, {
    onCancelled: async (id) => {
      await sendBookingEmails(admin, id, null, "cancelled").catch(() => null);
    },
  });
  return NextResponse.json({
    jobs: jobs.processed,
    recovered: recovered.recovered,
    reminders,
    calendar,
  });
}

export const GET = run;
export const POST = run;
