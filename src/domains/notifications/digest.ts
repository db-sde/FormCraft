import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { isValidTimeZone, zoneOffsetMinutes } from "@/domains/logic/datetime";
import { renderEmailHtml } from "./email-layout";
import { defaultSender, type Send } from "./mailer";
import { ruleRecipients } from "./rules";
import { parseFormSchema } from "@/domains/forms/schema";
import { npsOf } from "@/domains/responses/summary";

type Client = SupabaseClient<Database>;

/**
 * The daily digest (master spec F-25): one email per form about the
 * previous day, in the form's chosen time zone, to the teammates picked
 * (members who can see responses). The scheduled job runs once a day at
 * a fixed UTC time; whatever zone a form uses, its previous local day
 * has ended by then. `last_sent_on` is claimed before sending, so a
 * second run that day never sends it again. A day with no responses
 * sends nothing. Counts only — answers aren't in the digest.
 */

/** YYYY-MM-DD for an instant in a zone. */
export function localDate(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: isValidTimeZone(timeZone) ? timeZone : "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function previousDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** The UTC instant a local date starts at in a zone (daylight saving
 * included: the offset is the one in force at that local midnight). */
export function startOfLocalDay(date: string, timeZone: string): number {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d);
  let guess = wall - zoneOffsetMinutes(zone, wall) * 60_000;
  // One correction step settles offsets that change around that day.
  guess = wall - zoneOffsetMinutes(zone, guess) * 60_000;
  return guess;
}

export function dayWindow(date: string, timeZone: string): { from: string; to: string } {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return {
    from: new Date(startOfLocalDay(date, timeZone)).toISOString(),
    to: new Date(startOfLocalDay(next, timeZone)).toISOString(),
  };
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD date. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The period a digest covers on a run, or null when it isn't due: daily,
 * the previous local day; weekly, Monday to Sunday, sent on the run after
 * the Sunday (claimed by that Sunday's date).
 */
export function digestPeriod(
  frequency: "daily" | "weekly",
  previous: string,
): { first: string; last: string } | null {
  if (frequency === "daily") return { first: previous, last: previous };
  if (weekdayOf(previous) !== 0) return null;
  return { first: addDays(previous, -6), last: previous };
}

export function digestEmail(input: {
  formTitle: string;
  day: string;
  /** The first day, for a weekly digest. */
  firstDay?: string;
  timeZone: string;
  completed: number;
  started: number;
  nps?: { label: string; score: number; responses: number } | null;
  responsesUrl: string;
  settingsUrl: string;
}) {
  const title = input.formTitle || "Untitled form";
  const weekly = Boolean(input.firstDay && input.firstDay !== input.day);
  const kind = weekly ? "Weekly digest" : "Daily digest";
  const subject = `${kind}: ${input.completed} new response${input.completed === 1 ? "" : "s"} · ${title}`;
  const body = weekly
    ? `Here's how “${title}” did from ${input.firstDay} to ${input.day} (${input.timeZone}).`
    : `Here's how “${title}” did on ${input.day} (${input.timeZone}).`;
  const npsLine = input.nps
    ? `${input.nps.score > 0 ? "+" : ""}${input.nps.score} from ${input.nps.responses} answers`
    : null;
  const html = renderEmailHtml({
    tag: kind,
    tagColor: "#e4ecfb",
    title: subject,
    body,
    meta: [
      { label: "Completed", value: String(input.completed) },
      {
        label: "Started but not finished",
        value: String(Math.max(0, input.started - input.completed)),
      },
      ...(input.nps && npsLine
        ? [{ label: `NPS · ${input.nps.label}`, value: npsLine }]
        : []),
    ],
    button: { label: "See responses", href: input.responsesUrl },
    fine: `You're getting this because a teammate added you to this form's ${weekly ? "weekly" : "daily"} digest.`,
    footerLink: { label: "Notification settings", href: input.settingsUrl },
  });
  const text = [
    subject,
    "",
    body,
    `Completed: ${input.completed}`,
    `Started but not finished: ${Math.max(0, input.started - input.completed)}`,
    ...(input.nps && npsLine ? [`NPS (${input.nps.label}): ${npsLine}`] : []),
    "",
    `See responses: ${input.responsesUrl}`,
    `Notification settings: ${input.settingsUrl}`,
  ].join("\n");
  return { subject, html, text };
}

/** Sends every digest that's due. Returns how many went out. */
export async function sendDueDigests(
  admin: Client,
  options: { now?: Date; send?: Send | null } = {},
): Promise<{ sent: number; skipped: number }> {
  const now = (options.now ?? new Date()).getTime();
  const send = options.send === undefined ? defaultSender() : options.send;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  let sent = 0;
  let skipped = 0;
  const { data: digests } = await admin
    .from("notification_digests")
    .select(
      "form_id, member_ids, time_zone, frequency, last_sent_on, forms!inner(title, workspace_id, deleted_at)",
    )
    .eq("enabled", true)
    .is("forms.deleted_at", null);
  for (const digest of digests ?? []) {
    const form = digest.forms as { title: string; workspace_id: string };
    const period = digestPeriod(
      digest.frequency === "weekly" ? "weekly" : "daily",
      previousDay(localDate(now, digest.time_zone)),
    );
    if (!period) continue;
    const day = period.last;
    if (digest.last_sent_on && digest.last_sent_on >= day) continue;
    // Claim the day first: a second run can't send it again.
    const claim = admin
      .from("notification_digests")
      .update({ last_sent_on: day })
      .eq("form_id", digest.form_id);
    const { data: claimed } = await (
      digest.last_sent_on ? claim.lt("last_sent_on", day) : claim.is("last_sent_on", null)
    ).select("form_id");
    if (!claimed?.length) continue;

    const window = {
      from: dayWindow(period.first, digest.time_zone).from,
      to: dayWindow(day, digest.time_zone).to,
    };
    const count = async (
      column: "completed_at" | "started_at",
      completedOnly: boolean,
    ) => {
      let q = admin
        .from("responses")
        .select("id", { count: "exact", head: true })
        .eq("form_id", digest.form_id)
        .eq("is_preview", false)
        .eq("spam_suspected", false)
        .gte(column, window.from)
        .lt(column, window.to);
      if (completedOnly) q = q.eq("status", "completed");
      return (await q).count ?? 0;
    };
    const [completed, started] = await Promise.all([
      count("completed_at", true),
      count("started_at", false),
    ]);
    if (completed === 0 && started === 0) {
      skipped += 1;
      continue;
    }
    const to = await ruleRecipients(admin, form.workspace_id, digest.member_ids);
    if (!send || to.length === 0) {
      skipped += 1;
      continue;
    }
    const nps = await periodNps(admin, digest.form_id, window);
    const email = digestEmail({
      formTitle: form.title,
      day,
      firstDay: period.first,
      nps,
      timeZone: digest.time_zone,
      completed,
      started,
      responsesUrl: `${appUrl}/forms/${digest.form_id}/responses`,
      settingsUrl: `${appUrl}/forms/${digest.form_id}/integrations`,
    });
    const result = await send({ ...email, to });
    if (result.ok) sent += 1;
    else {
      // Let the next run try that day again.
      await admin
        .from("notification_digests")
        .update({ last_sent_on: digest.last_sent_on })
        .eq("form_id", digest.form_id)
        .eq("last_sent_on", day);
      skipped += 1;
    }
  }
  return { sent, skipped };
}

/** NPS over a period for the form's first 0–10 scale, if it has one. */
async function periodNps(
  admin: Client,
  formId: string,
  window: { from: string; to: string },
): Promise<{ label: string; score: number; responses: number } | null> {
  const { data: live } = await admin
    .from("form_versions")
    .select("schema")
    .eq("form_id", formId)
    .eq("status", "published")
    .maybeSingle();
  if (!live) return null;
  const question = parseFormSchema(live.schema).questions.find(
    (q) => q.type === "opinion_scale" && q.settings.min === 0 && q.settings.max === 10,
  );
  if (!question) return null;
  const { data } = await admin
    .from("answers")
    .select(
      "value, responses!inner(form_id, status, is_preview, spam_suspected, completed_at)",
    )
    .eq("question_id", question.id)
    .eq("responses.form_id", formId)
    .eq("responses.status", "completed")
    .eq("responses.is_preview", false)
    .eq("responses.spam_suspected", false)
    .gte("responses.completed_at", window.from)
    .lt("responses.completed_at", window.to)
    .limit(5000);
  const result = npsOf(
    (data ?? []).map((a) => a.value).filter((v): v is number => typeof v === "number"),
  );
  return result
    ? {
        label: question.label.trim() || "Score",
        score: result.score,
        responses: result.responses,
      }
    : null;
}
