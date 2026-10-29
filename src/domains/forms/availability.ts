import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * Whether a published form is still taking responses (master spec F-46
 * close date, F-47 response cap). The database has the final say at
 * completion (complete_response_atomic refuses a closed or full form in
 * the same transaction as the write); this is the same rule, checked
 * earlier, so people see the closed message when they open the link or
 * start answering instead of only when they submit.
 */

export type AvailabilitySettings = {
  closesAt: string | null;
  closedMessage: string | null;
  responseCap: number | null;
  fullMessage: string | null;
};

export type Availability =
  { open: true } | { open: false; reason: "closed" | "full"; message: string };

export const DEFAULT_CLOSED_MESSAGE = "This form is no longer accepting responses.";
export const DEFAULT_FULL_MESSAGE =
  "This form has reached its limit and isn't accepting more responses.";
export const MAX_MESSAGE_LENGTH = 500;
export const MAX_RESPONSE_CAP = 1_000_000;

/** Closed beats full: past the deadline, the deadline is the reason. */
export function availabilityOf(
  settings: AvailabilitySettings,
  accepted: number,
  now: Date = new Date(),
): Availability {
  if (settings.closesAt && now.getTime() >= new Date(settings.closesAt).getTime()) {
    return {
      open: false,
      reason: "closed",
      message: settings.closedMessage?.trim() || DEFAULT_CLOSED_MESSAGE,
    };
  }
  if (settings.responseCap !== null && accepted >= settings.responseCap) {
    return {
      open: false,
      reason: "full",
      message: settings.fullMessage?.trim() || DEFAULT_FULL_MESSAGE,
    };
  }
  return { open: true };
}

/** The message for a completion the database refused. */
export function refusalMessage(
  reason: "closed" | "full",
  settings: Pick<AvailabilitySettings, "closedMessage" | "fullMessage">,
): string {
  return reason === "closed"
    ? settings.closedMessage?.trim() || DEFAULT_CLOSED_MESSAGE
    : settings.fullMessage?.trim() || DEFAULT_FULL_MESSAGE;
}

/** Completed responses that use up a place: suspected spam doesn't
 * (the same count complete_response_atomic makes). */
export async function countAcceptedResponses(
  admin: Client,
  formId: string,
): Promise<number> {
  const { count, error } = await admin
    .from("responses")
    .select("id", { count: "exact", head: true })
    .eq("form_id", formId)
    .eq("status", "completed")
    .eq("spam_suspected", false);
  if (error) throw error;
  return count ?? 0;
}

export async function getAvailabilitySettings(
  admin: Client,
  formId: string,
): Promise<AvailabilitySettings | null> {
  const { data, error } = await admin
    .from("forms")
    .select("closes_at, closed_message, response_cap, full_message")
    .eq("id", formId)
    .maybeSingle();
  if (error) throw error;
  return data
    ? {
        closesAt: data.closes_at,
        closedMessage: data.closed_message,
        responseCap: data.response_cap,
        fullMessage: data.full_message,
      }
    : null;
}

/** The form's availability right now. Counts responses only when the
 * form has a cap. */
export async function checkAvailability(
  admin: Client,
  formId: string,
  now: Date = new Date(),
): Promise<Availability> {
  const settings = await getAvailabilitySettings(admin, formId);
  if (!settings) return { open: true };
  const accepted =
    settings.responseCap === null ? 0 : await countAcceptedResponses(admin, formId);
  return availabilityOf(settings, accepted, now);
}

/** Saves a form's close date and response cap with the signed-in
 * creator's client (row-level security limits it to their workspace). */
export async function updateAvailabilitySettings(
  supabase: Client,
  formId: string,
  workspaceId: string,
  settings: AvailabilitySettings,
): Promise<void> {
  const { error } = await supabase
    .from("forms")
    .update({
      closes_at: settings.closesAt,
      closed_message: settings.closedMessage?.trim() || null,
      response_cap: settings.responseCap,
      full_message: settings.fullMessage?.trim() || null,
    })
    .eq("id", formId)
    .eq("workspace_id", workspaceId);
  if (error) throw error;
}

export async function setCaptchaRequired(
  supabase: Client,
  formId: string,
  workspaceId: string,
  required: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("forms")
    .update({ captcha_required: required })
    .eq("id", formId)
    .eq("workspace_id", workspaceId);
  if (error) throw error;
}
