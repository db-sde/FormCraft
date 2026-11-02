import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectUnlessCron } from "@/lib/http/cron-auth";
import "@/domains/connectors/registry";
import { dispatchConnectorJobs } from "@/domains/connectors/framework";
import { syncCalendarBookings } from "@/domains/bookings/google-calendar";
import { sendBookingEmails, sendDueReminders } from "@/domains/bookings/emails";

/**
 * The connectors worker (spec §5.3): runs due connector jobs (calendar
 * events now, CRM records in Phase 6), sends booking reminders, and
 * picks up bookings deleted or moved in Google Calendar. CRON_SECRET.
 */
async function run(request: NextRequest) {
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;
  const admin = createAdminClient();
  const jobs = await dispatchConnectorJobs(admin);
  const reminders = await sendDueReminders(admin);
  const calendar = await syncCalendarBookings(admin, {
    onCancelled: async (id) => {
      await sendBookingEmails(admin, id, null, "cancelled").catch(() => null);
    },
  });
  return NextResponse.json({ jobs: jobs.processed, reminders, calendar });
}

export const GET = run;
export const POST = run;
