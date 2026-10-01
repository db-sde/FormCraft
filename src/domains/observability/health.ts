import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/** How long a retry may be overdue before something is wrong. The sweeps
 * run every 5 minutes, so a job waiting this long means they aren't
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
  stuckUploads: number;
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
  ] as const) {
    if (queue.overdue > 0) {
      problems.push(
        `${plural(queue.overdue, name)} overdue by up to ${queue.oldestOverdueMinutes} minutes — is the cron sweep running?`,
      );
    }
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

async function queueHealth(
  admin: Client,
  table: "webhook_deliveries" | "sheets_sync_log",
  now: Date,
): Promise<JobQueueHealth> {
  const overdueBefore = new Date(now.getTime() - OVERDUE_AFTER_MINUTES * 60_000);
  const dayAgo = new Date(now.getTime() - 24 * 3_600_000);

  const [overdue, oldest, exhausted] = await Promise.all([
    admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "failed"])
      .lt("next_attempt_at", overdueBefore.toISOString()),
    admin
      .from(table)
      .select("next_attempt_at")
      .in("status", ["pending", "failed"])
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
  const [webhooks, sheets, stuck] = await Promise.all([
    queueHealth(admin, "webhook_deliveries", now),
    queueHealth(admin, "sheets_sync_log", now),
    admin
      .from("uploads")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .lt("created_at", stuckBefore.toISOString()),
  ]);
  if (stuck.error) throw stuck.error;
  return assessHealth({ webhooks, sheets, stuckUploads: stuck.count ?? 0 }, now);
}
