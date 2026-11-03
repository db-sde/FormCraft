import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import { walkForm } from "@/domains/logic/walk";
import { cleanAddress } from "@/domains/notifications/mailer";
import { confirmBooking, loadBookingType, releaseHold, reserveSlot } from "./server";
import { sendBookingEmails } from "./emails";
import "@/domains/connectors/registry";
import { dispatchConnectorJobs } from "@/domains/connectors/framework";

type Client = SupabaseClient<Database>;

/**
 * The booking step of a submit (F-27): before the response completes,
 * hold the slot each booking question on the path asks for; after, confirm
 * them (or release them if it didn't complete). A slot that can't be
 * held is an answer error on that question — the response doesn't
 * complete, and the respondent picks another time.
 */

export type Held = {
  bookingId: string;
  questionId: string;
  token: string;
  existing: boolean;
};

function textAnswer(
  schema: ReturnType<typeof parseFormSchema>,
  answers: Record<string, unknown>,
  questionId: string | undefined,
  field: "name" | "email",
): string | null {
  if (!questionId) return null;
  const q = schema.questions.find((x) => x.id === questionId);
  const raw = answers[questionId];
  const value =
    q?.type === "contact_info" ? (raw as Record<string, unknown> | null)?.[field] : raw;
  if (typeof value !== "string" || !value.trim()) return null;
  return field === "email" ? cleanAddress(value) : value.trim().slice(0, 200);
}

export async function holdBookings(
  admin: Client,
  responseId: string,
  answers: Record<string, unknown>,
): Promise<
  | { ok: true; held: Held[] }
  | { ok: false; errors: { questionId: string; message: string }[] }
> {
  const { data: response } = await admin
    .from("responses")
    .select(
      "form_id, form_version_id, hidden_fields, random_seed, forms!inner(workspace_id)",
    )
    .eq("id", responseId)
    .maybeSingle();
  if (!response) return { ok: true, held: [] };
  const { data: version } = await admin
    .from("form_versions")
    .select("schema")
    .eq("id", response.form_version_id)
    .single();
  if (!version) return { ok: true, held: [] };
  const schema = parseFormSchema(version.schema);
  const questions = schema.questions.filter((q) => q.type === "booking");
  if (questions.length === 0) return { ok: true, held: [] };

  const hidden = Object.fromEntries(
    Object.entries((response.hidden_fields ?? {}) as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  const reached = new Set(
    walkForm(compileFormSchema(schema), answers, {
      hidden,
      seed: response.random_seed ?? undefined,
    }).visitedQuestionIds,
  );
  const workspaceId = (response.forms as { workspace_id: string }).workspace_id;
  const held: Held[] = [];
  for (const q of questions) {
    if (q.type !== "booking" || !reached.has(q.id)) continue;
    const answer = answers[q.id] as { start?: unknown; timeZone?: unknown } | undefined;
    if (!answer || typeof answer.start !== "string") continue;
    const type = q.settings.bookingTypeId
      ? await loadBookingType(admin, q.settings.bookingTypeId)
      : null;
    if (!type || type.workspaceId !== workspaceId) {
      for (const h of held) await releaseHold(admin, h.bookingId);
      return {
        ok: false,
        errors: [{ questionId: q.id, message: "Bookings aren't available right now." }],
      };
    }
    const result = await reserveSlot(admin, {
      type,
      start: answer.start,
      formId: response.form_id,
      responseId,
      attendee: {
        name: textAnswer(schema, answers, q.settings.nameQuestionId, "name"),
        email: textAnswer(schema, answers, q.settings.emailQuestionId, "email"),
        timeZone:
          typeof answer.timeZone === "string" ? answer.timeZone.slice(0, 64) : null,
      },
    });
    if (!result.ok) {
      for (const h of held) await releaseHold(admin, h.bookingId);
      return { ok: false, errors: [{ questionId: q.id, message: result.message }] };
    }
    held.push({
      bookingId: result.bookingId,
      questionId: q.id,
      token: result.token,
      existing: Boolean(result.existing),
    });
  }
  return { ok: true, held };
}

/** After the response: confirm or release (before the reply goes out).
 * Returns the bookings newly confirmed, to email. Never throws. */
export async function settleBookings(
  admin: Client,
  held: Held[],
  responseId: string,
  completed: boolean,
): Promise<Held[]> {
  const confirmed: Held[] = [];
  for (const h of held) {
    try {
      if (!completed) {
        if (!h.existing) await releaseHold(admin, h.bookingId);
        continue;
      }
      if (await confirmBooking(admin, h.bookingId, responseId)) confirmed.push(h);
    } catch {
      // The booking row stays as it is; the 15-minute hold limit
      // settles anything left pending.
    }
  }
  return confirmed;
}

/** Confirmation emails for newly confirmed bookings, and their calendar
 * events straight away (the cron only retries). */
export async function emailConfirmed(admin: Client, confirmed: Held[]): Promise<void> {
  for (const h of confirmed) {
    await dispatchConnectorJobs(admin, { bookingId: h.bookingId }).catch(() => null);
  }
  for (const h of confirmed) {
    if (h.token) {
      await sendBookingEmails(admin, h.bookingId, h.token, "confirmed").catch(() => null);
    }
  }
}
