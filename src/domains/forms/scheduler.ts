import type { EndingV1, FormSchemaV1 } from "./schema/v1";

/**
 * Booking after an ending (PRD P2.16): the ending shows the creator's
 * Calendly or Cal.com page inline, prefilled with the respondent's name
 * and email and tagged with the response id so the booking can be tied
 * back to the answers that qualified it. Only those providers' own hosts
 * are embedded.
 */

export type Scheduler = NonNullable<EndingV1["scheduler"]>;

const HOSTS: Record<Scheduler["provider"], RegExp> = {
  calendly: /^(www\.)?calendly\.com$/,
  cal: /^(app\.)?cal\.com$/,
};

export function isSchedulerUrl(provider: Scheduler["provider"], url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && HOSTS[provider].test(parsed.hostname);
  } catch {
    return false;
  }
}

/** The respondent's name and email, from the form's contact block or
 * email question, for prefilling. */
export function contactFromAnswers(
  schema: Pick<FormSchemaV1, "questions">,
  answers: Record<string, unknown>,
): { name?: string; email?: string } {
  const out: { name?: string; email?: string } = {};
  for (const q of schema.questions) {
    const value = answers[q.id];
    if (q.type === "contact_info" && value && typeof value === "object") {
      const record = value as { name?: unknown; email?: unknown };
      if (!out.name && typeof record.name === "string") out.name = record.name;
      if (!out.email && typeof record.email === "string") out.email = record.email;
    }
    if (q.type === "email" && !out.email && typeof value === "string") out.email = value;
  }
  return out;
}

export function schedulerEmbedUrl(
  scheduler: Scheduler,
  prefill: { name?: string; email?: string; responseId?: string },
): string | null {
  if (!isSchedulerUrl(scheduler.provider, scheduler.url)) return null;
  const url = new URL(scheduler.url);
  if (prefill.name) url.searchParams.set("name", prefill.name.slice(0, 100));
  if (prefill.email) url.searchParams.set("email", prefill.email.slice(0, 254));
  if (prefill.responseId) {
    if (scheduler.provider === "calendly") {
      url.searchParams.set("utm_source", "formcraft");
      url.searchParams.set("utm_content", prefill.responseId);
    } else {
      url.searchParams.set("metadata[formcraftResponseId]", prefill.responseId);
    }
  }
  if (scheduler.provider === "calendly") url.searchParams.set("embed_type", "Inline");
  else url.searchParams.set("embed", "true");
  return url.toString();
}
