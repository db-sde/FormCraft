/**
 * When an unfinished response counts as abandoned rather than still in
 * progress (PRD P2.7: don't label every in-progress session abandoned).
 * Derived from `last_active_at` at read time — never stored — so the
 * threshold can change without rewriting any data.
 */
export const ABANDONED_AFTER_MINUTES = 30;

export type ResponseActivity = "completed" | "in_progress" | "abandoned";

export function responseActivity(
  response: { status: string; lastActiveAt: string },
  now: Date = new Date(),
): ResponseActivity {
  if (response.status === "completed") return "completed";
  const idleMs = now.getTime() - new Date(response.lastActiveAt).getTime();
  return idleMs >= ABANDONED_AFTER_MINUTES * 60_000 ? "abandoned" : "in_progress";
}

export const ACTIVITY_LABEL: Record<ResponseActivity, string> = {
  completed: "Completed",
  in_progress: "In progress",
  abandoned: "Abandoned",
};

/** "3 min", "1 h 20 min", "2 d 4 h" — time between two instants. */
export function formatDuration(fromIso: string, toIso: string): string {
  const totalMinutes = Math.max(
    0,
    Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000),
  );
  if (totalMinutes < 1) return "under a minute";
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  if (hours < 24) {
    const minutes = totalMinutes % 60;
    return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days} d ${remHours} h` : `${days} d`;
}

/** Where a respondent came from, for display: campaign source, else the
 * referring site's host, else "Direct". */
export function describeSource(meta: {
  utmSource?: string | null;
  referrer?: string | null;
}): string {
  if (meta.utmSource) return meta.utmSource;
  if (meta.referrer) {
    try {
      return new URL(meta.referrer).hostname.replace(/^www\./, "");
    } catch {
      return meta.referrer;
    }
  }
  return "Direct";
}
