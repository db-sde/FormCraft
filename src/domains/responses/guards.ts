import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/** What the submit route checks before a response may complete: its
 * form (for the password cookie), whether it already completed (a
 * retried submit is answered without re-checking anything), and
 * whether it still has to pass the form's CAPTCHA. */
export type SubmissionGuards = {
  formId: string;
  completed: boolean;
  /** The form requires a CAPTCHA and this response hasn't passed it. */
  needsCaptcha: boolean;
  /** The form has a payment set up; without one, submit skips the
   * payment step's lookups (QA FC4-28). */
  takesPayment: boolean;
  /** The version answered: which steps the submit needs (bookings,
   * products) is read from it. */
  formVersionId: string;
};

export async function submissionGuards(
  admin: Client,
  responseId: string,
): Promise<SubmissionGuards | null> {
  const { data, error } = await admin
    .from("responses")
    .select(
      "form_id, form_version_id, status, captcha_verified_at, forms!inner(captcha_required, payment_config)",
    )
    .eq("id", responseId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const form = data.forms as { captcha_required: boolean; payment_config: unknown };
  return {
    formId: data.form_id,
    completed: data.status === "completed",
    needsCaptcha: form.captcha_required && data.captcha_verified_at === null,
    takesPayment: form.payment_config !== null && form.payment_config !== undefined,
    formVersionId: data.form_version_id,
  };
}

/** Records that the response passed the CAPTCHA. Once per response:
 * tokens are single-use, so a resubmit after fixing an answer must not
 * need a new one. */
export async function markCaptchaVerified(admin: Client, responseId: string) {
  const { error } = await admin
    .from("responses")
    .update({ captcha_verified_at: new Date().toISOString() })
    .eq("id", responseId);
  if (error) throw error;
}
