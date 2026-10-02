import "server-only";
import { Resend } from "resend";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";
import { compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import { getWorkspacePlan } from "@/domains/billing/entitlements";
import { renderRecall } from "@/domains/logic/recall";
import { walkForm } from "@/domains/logic/walk";
import { renderEmailHtml } from "./email-layout";

type Client = SupabaseClient<Database>;

/**
 * Respondent confirmation emails (PRD P2.18). Built so the feature can't
 * be turned into a mail cannon: the recipient is only ever the address
 * the respondent typed into this form's chosen email question; one
 * email per response (claimed in confirmation_email_log first); none for
 * spam-flagged responses; a daily cap per form; and the creator's text
 * is plain text, escaped into the standard layout — never raw HTML.
 */

export const DAILY_CONFIRMATIONS_PER_FORM = 500;

export const ConfirmationSettings = z.object({
  enabled: z.boolean(),
  recipientQuestionId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .nullable(),
  subject: z.string().trim().min(1).max(150),
  body: z.string().trim().min(1).max(4000),
  ctaLabel: z.string().trim().max(60).nullable(),
  ctaUrl: z
    .string()
    .trim()
    .max(2000)
    .regex(/^https:\/\/\S+$/, "The button link must start with https://")
    .nullable(),
});
export type ConfirmationSettings = z.infer<typeof ConfirmationSettings>;

export const DEFAULT_CONFIRMATION: ConfirmationSettings = {
  enabled: false,
  recipientQuestionId: null,
  subject: "Thanks for your response",
  body: "We've got your answers. Thank you!",
  ctaLabel: null,
  ctaUrl: null,
};

/** Questions whose answer can be the recipient: email questions and
 * contact blocks that ask for an email. */
export function emailQuestions(schema: FormSchemaV1): QuestionV1[] {
  return schema.questions.filter(
    (q) =>
      q.type === "email" ||
      (q.type === "contact_info" &&
        (q.settings as { fields?: string[] }).fields?.includes("email")),
  );
}

export async function getConfirmationSettings(
  supabase: Client,
  formId: string,
): Promise<ConfirmationSettings> {
  const { data } = await supabase
    .from("confirmation_emails")
    .select("*")
    .eq("form_id", formId)
    .maybeSingle();
  if (!data) return DEFAULT_CONFIRMATION;
  return {
    enabled: data.enabled,
    recipientQuestionId: data.recipient_question_id,
    subject: data.subject,
    body: data.body,
    ctaLabel: data.cta_label,
    ctaUrl: data.cta_url,
  };
}

export async function saveConfirmationSettings(
  supabase: Client,
  formId: string,
  settings: ConfirmationSettings,
): Promise<void> {
  const { error } = await supabase.from("confirmation_emails").upsert({
    form_id: formId,
    enabled: settings.enabled,
    recipient_question_id: settings.recipientQuestionId,
    subject: settings.subject,
    body: settings.body,
    cta_label: settings.ctaLabel || null,
    cta_url: settings.ctaUrl || null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** The respondent's address from the chosen question, if it's valid. */
export function recipientFrom(
  question: QuestionV1 | undefined,
  answer: unknown,
): string | null {
  if (!question) return null;
  const value =
    question.type === "contact_info"
      ? (answer as { email?: unknown } | null)?.email
      : answer;
  if (typeof value !== "string") return null;
  const email = value.trim();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

/** The email for a response: recall filled in, plain text only. */
export function buildConfirmationEmail(input: {
  settings: ConfirmationSettings;
  schema: FormSchemaV1;
  answers: Record<string, unknown>;
  variables: Record<string, unknown>;
  hidden: Record<string, string>;
  to: string;
}) {
  const source = {
    schema: input.schema,
    answers: input.answers,
    variables: input.variables as Record<string, never>,
    hidden: input.hidden,
  };
  // Newlines and tabs in a subject line could be header tricks.
  const subject = renderRecall(input.settings.subject, source)
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 200);
  const body = renderRecall(input.settings.body, source);
  const cta =
    input.settings.ctaUrl && input.settings.ctaLabel
      ? { label: input.settings.ctaLabel, href: input.settings.ctaUrl }
      : null;
  return {
    subject,
    text: cta ? `${body}\n\n${cta.label}: ${cta.href}` : body,
    html: renderEmailHtml({
      tag: input.schema.meta.title.slice(0, 40),
      tagColor: "#f2b233",
      title: subject,
      body,
      button: cta ?? undefined,
      fine: "You're getting this because you filled in this form.",
      sentTo: input.to,
    }),
  };
}

export type ConfirmationResult =
  | { sent: true }
  | {
      sent: false;
      reason:
        | "not_enabled"
        | "not_on_plan"
        | "no_recipient"
        | "already_handled"
        | "daily_cap"
        | "no_api_key"
        | "spam"
        | "send_failed";
    };

/** Sends the confirmation for a completed response, at most once.
 * Never throws: it runs after the response is saved. Service role. */
export async function sendConfirmationEmail(
  admin: Client,
  responseId: string,
  options: {
    send?: (message: {
      to: string;
      subject: string;
      html: string;
      text: string;
    }) => Promise<boolean>;
  } = {},
): Promise<ConfirmationResult> {
  try {
    const { data: response } = await admin
      .from("responses")
      .select(
        "form_id, form_version_id, status, spam_suspected, hidden_fields, random_seed, completed_at, forms!inner(workspace_id)",
      )
      .eq("id", responseId)
      .single();
    if (!response || response.status !== "completed")
      return { sent: false, reason: "no_recipient" };
    if (response.spam_suspected) return { sent: false, reason: "spam" };

    const settings = await getConfirmationSettings(admin, response.form_id);
    if (!settings.enabled || !settings.recipientQuestionId) {
      return { sent: false, reason: "not_enabled" };
    }
    const workspaceId = (response.forms as { workspace_id: string }).workspace_id;
    const { entitlements } = await getWorkspacePlan(admin, workspaceId);
    if (!entitlements.confirmation_emails) return { sent: false, reason: "not_on_plan" };

    const [{ data: version }, { data: answerRows }] = await Promise.all([
      admin
        .from("form_versions")
        .select("schema")
        .eq("id", response.form_version_id)
        .single(),
      admin.from("answers").select("question_id, value").eq("response_id", responseId),
    ]);
    const schema = parseFormSchema(version!.schema);
    const answers = Object.fromEntries(
      (answerRows ?? []).map((a) => [a.question_id, a.value]),
    );
    const question = schema.questions.find((q) => q.id === settings.recipientQuestionId);
    const to = recipientFrom(question, answers[settings.recipientQuestionId]);
    if (!to) return { sent: false, reason: "no_recipient" };

    const send =
      options.send ??
      (process.env.RESEND_API_KEY
        ? async (message: {
            to: string;
            subject: string;
            html: string;
            text: string;
          }) => {
            const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
              from: process.env.EMAIL_FROM ?? "FormCraft <notifications@formcraft.local>",
              ...message,
            });
            return !error;
          }
        : null);
    if (!send) return { sent: false, reason: "no_api_key" };

    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await admin
      .from("confirmation_email_log")
      .select("response_id", { count: "exact", head: true })
      .eq("form_id", response.form_id)
      .eq("status", "sent")
      .gte("created_at", since);
    if ((count ?? 0) >= DAILY_CONFIRMATIONS_PER_FORM)
      return { sent: false, reason: "daily_cap" };

    // Claim the send: a second call for the same response stops here.
    const { error: claimError } = await admin
      .from("confirmation_email_log")
      .insert({ response_id: responseId, form_id: response.form_id, status: "sending" });
    if (claimError) return { sent: false, reason: "already_handled" };

    const hidden = Object.fromEntries(
      Object.entries((response.hidden_fields ?? {}) as Record<string, unknown>).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
    const walk = walkForm(compileFormSchema(schema), answers, {
      hidden,
      seed: response.random_seed ?? undefined,
      now: response.completed_at ? new Date(response.completed_at) : undefined,
    });
    const email = buildConfirmationEmail({
      settings,
      schema,
      answers,
      variables: walk.variables,
      hidden,
      to,
    });
    const ok = await send({ to, ...email });
    await admin
      .from("confirmation_email_log")
      .update({ status: ok ? "sent" : "failed", error: ok ? null : "send failed" })
      .eq("response_id", responseId);
    return ok ? { sent: true } : { sent: false, reason: "send_failed" };
  } catch {
    return { sent: false, reason: "send_failed" };
  }
}
