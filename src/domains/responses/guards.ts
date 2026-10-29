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
};

export async function submissionGuards(
  admin: Client,
  responseId: string,
): Promise<SubmissionGuards | null> {
  const { data, error } = await admin
    .from("responses")
    .select("form_id, status, captcha_verified_at, forms!inner(captcha_required)")
    .eq("id", responseId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const form = data.forms as { captcha_required: boolean };
  return {
    formId: data.form_id,
    completed: data.status === "completed",
    needsCaptcha: form.captcha_required && data.captcha_verified_at === null,
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
