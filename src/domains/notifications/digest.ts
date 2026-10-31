import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { isValidTimeZone, zoneOffsetMinutes } from "@/domains/logic/datetime";
import { renderEmailHtml } from "./email-layout";
import { defaultSender, type Send } from "./mailer";
import { ruleRecipients } from "./rules";

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

export function digestEmail(input: {
  formTitle: string;
  day: string;
  timeZone: string;
  completed: number;
  started: number;
  responsesUrl: string;
  settingsUrl: string;
}) {
  const title = input.formTitle || "Untitled form";
  const subject = `Daily digest: ${input.completed} new response${input.completed === 1 ? "" : "s"} · ${title}`;
  const body = `Here's how “${title}” did on ${input.day} (${input.timeZone}).`;
  const html = renderEmailHtml({
    tag: "Daily digest",
    tagColor: "#e4ecfb",
    title: subject,
    body,
    meta: [
      { label: "Completed", value: String(input.completed) },
      {
        label: "Started but not finished",
        value: String(Math.max(0, input.started - input.completed)),
      },
    ],
    button: { label: "See responses", href: input.responsesUrl },
    fine: "You're getting this because a teammate added you to this form's daily digest.",
    footerLink: { label: "Notification settings", href: input.settingsUrl },
  });
  const text = [
    subject,
    "",
    body,
    `Completed: ${input.completed}`,
    `Started but not finished: ${Math.max(0, input.started - input.completed)}`,
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
      "form_id, member_ids, time_zone, last_sent_on, forms!inner(title, workspace_id, deleted_at)",
    )
    .eq("enabled", true)
    .is("forms.deleted_at", null);
  for (const digest of digests ?? []) {
    const form = digest.forms as { title: string; workspace_id: string };
    const day = previousDay(localDate(now, digest.time_zone));
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

    const window = dayWindow(day, digest.time_zone);
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
    const email = digestEmail({
      formTitle: form.title,
      day,
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
