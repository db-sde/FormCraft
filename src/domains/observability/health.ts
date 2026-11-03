import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/** How long a retry may be overdue before something is wrong. The sweeps
 * run every minute (migration 54), so a job waiting this long means they aren't
 * running (or are failing before they reach it). */
export const OVERDUE_AFTER_MINUTES = 15;
/** A file stuck "pending" this long was never finished or scanned. */
export const STUCK_UPLOAD_AFTER_MINUTES = 60;

export type JobQueueHealth = {
  /** Waiting to be sent, and more than OVERDUE_AFTER_MINUTES late. */
  overdue: number;
  /** Minutes the most overdue one has been waiting (0 if none). */
  oldestOverdueMinutes: number;
  /** Gave up after every retry in the last 24 hours. */
  exhaustedLast24h: number;
};

export type HealthSnapshot = {
  webhooks: JobQueueHealth;
  sheets: JobQueueHealth;
  /** Calendar events and app syncs (master spec §5.3). */
  connectors?: JobQueueHealth;
  stuckUploads: number;
  /** Confirmed bookings due a reminder that the worker hasn't sent. */
  overdueReminders?: number;
  /** Second payments for already-paid responses (24h): someone must
   * refund them. */
  duplicatePaymentsLast24h?: number;
};

export type HealthReport = HealthSnapshot & {
  status: "ok" | "degraded";
  /** Plain-language reasons the status isn't "ok". */
  problems: string[];
  checkedAt: string;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Turns raw counts into a verdict. Exhausted jobs are reported but don't
 * degrade the status on their own — a creator's endpoint being down is
 * theirs to fix, not an outage of ours; overdue jobs mean OUR workers
 * stopped, which is. */
export function assessHealth(snapshot: HealthSnapshot, now = new Date()): HealthReport {
  const problems: string[] = [];
  for (const [name, queue] of [
    ["webhook delivery", snapshot.webhooks],
    ["Google Sheets sync", snapshot.sheets],
    ["calendar or app sync", snapshot.connectors],
  ] as const) {
    if (queue && queue.overdue > 0) {
      problems.push(
        `${plural(queue.overdue, name)} overdue by up to ${queue.oldestOverdueMinutes} minutes — is the cron sweep running?`,
      );
    }
  }
  if (snapshot.overdueReminders) {
    problems.push(
      `${plural(snapshot.overdueReminders, "booking reminder")} not sent — is the connectors worker running?`,
    );
  }
  if (snapshot.duplicatePaymentsLast24h) {
    problems.push(
      `${plural(snapshot.duplicatePaymentsLast24h, "duplicate payment")} in the last day — refund them in the payment provider`,
    );
  }
  if (snapshot.stuckUploads > 0) {
    problems.push(`${plural(snapshot.stuckUploads, "upload")} stuck in "pending"`);
  }
  return {
    ...snapshot,
    status: problems.length === 0 ? "ok" : "degraded",
    problems,
    checkedAt: now.toISOString(),
  };
}

/** Statuses of work still to do (a connector job's lease lapsing while
 * "running" means its worker died). */
const OPEN = {
  webhook_deliveries: ["pending", "failed"],
  sheets_sync_log: ["pending", "failed"],
  connector_jobs: ["pending", "failed", "running"],
} as const;

async function queueHealth(
  admin: Client,
  table: "webhook_deliveries" | "sheets_sync_log" | "connector_jobs",
  now: Date,
): Promise<JobQueueHealth> {
  const overdueBefore = new Date(now.getTime() - OVERDUE_AFTER_MINUTES * 60_000);
  const dayAgo = new Date(now.getTime() - 24 * 3_600_000);

  const [overdue, oldest, exhausted] = await Promise.all([
    admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .in("status", OPEN[table])
      .lt("next_attempt_at", overdueBefore.toISOString()),
    admin
      .from(table)
      .select("next_attempt_at")
      .in("status", OPEN[table])
      .lt("next_attempt_at", overdueBefore.toISOString())
      .order("next_attempt_at", { ascending: true })
      .limit(1),
    admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("status", "exhausted")
      .gte("updated_at", dayAgo.toISOString()),
  ]);
  if (overdue.error) throw overdue.error;
  if (oldest.error) throw oldest.error;
  if (exhausted.error) throw exhausted.error;

  const oldestAt = oldest.data?.[0]?.next_attempt_at;
  return {
    overdue: overdue.count ?? 0,
    oldestOverdueMinutes: oldestAt
      ? Math.max(0, Math.floor((now.getTime() - new Date(oldestAt).getTime()) / 60_000))
      : 0,
    exhaustedLast24h: exhausted.count ?? 0,
  };
}

/** What the scheduled jobs and storage look like right now (service-role). */
export async function getHealthReport(
  admin: Client,
  now = new Date(),
): Promise<HealthReport> {
  const stuckBefore = new Date(now.getTime() - STUCK_UPLOAD_AFTER_MINUTES * 60_000);
  const [webhooks, sheets, connectors, stuck, reminders, duplicates] = await Promise.all([
    queueHealth(admin, "webhook_deliveries", now),
    queueHealth(admin, "sheets_sync_log", now),
    queueHealth(admin, "connector_jobs", now),
    admin
      .from("uploads")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .lt("created_at", stuckBefore.toISOString()),
    // Due (starting within the day) for a while, and still not reminded.
    admin
      .from("bookings")
      .select("id, booking_types!inner(reminders)", { count: "exact", head: true })
      .eq("status", "confirmed")
      .is("reminder_sent_at", null)
      .eq("booking_types.reminders", true)
      .gt("starts_at", now.toISOString())
      .lte("starts_at", new Date(now.getTime() + 23 * 3_600_000).toISOString())
      .lt(
        "created_at",
        new Date(now.getTime() - OVERDUE_AFTER_MINUTES * 60_000).toISOString(),
      ),
    admin
      .from("response_events")
      .select("id", { count: "exact", head: true })
      .eq("kind", "payment")
      .eq("outcome", "failed")
      .gte("created_at", new Date(now.getTime() - 24 * 3_600_000).toISOString()),
  ]);
  if (stuck.error) throw stuck.error;
  if (reminders.error) throw reminders.error;
  if (duplicates.error) throw duplicates.error;
  return assessHealth(
    {
      webhooks,
      sheets,
      connectors,
      stuckUploads: stuck.count ?? 0,
      overdueReminders: reminders.count ?? 0,
      duplicatePaymentsLast24h: duplicates.count ?? 0,
    },
    now,
  );
}
