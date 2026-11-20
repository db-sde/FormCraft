import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { FormSchemaV1, QuestionV1 } from "@/domains/forms/schema/v1";
import { signingKey } from "@/lib/crypto/keys";
import {
  cleanAddress,
  cleanSubject,
  defaultSender,
  type Send,
} from "@/domains/notifications/mailer";
import { renderEmailHtml } from "@/domains/notifications/email-layout";

type Client = SupabaseClient<Database>;

/**
 * Email verification codes (roadmap #8, email only). An email question
 * with `verify` on asks the respondent to prove the address is theirs
 * before the form can be submitted: a six-digit code is emailed to it.
 *
 * - A code lasts 10 minutes and allows 5 tries (counted before checking,
 *   in the database, so tries at once can't beat the limit).
 * - A new code can be sent after 30 seconds, at most 5 times per question
 *   of a response; the routes also limit sends per address and per IP.
 * - Only a keyed hash of the code is stored.
 * - A new address needs a new code: verifying one address never verifies
 *   another.
 *
 * Without an email service there's no way to send a code, so the switch
 * is ignored (the respondent is never stuck) and the builder says so.
 * It verifies an inbox, not a person's identity.
 */
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const RESEND_AFTER_MS = 30 * 1000;
export const MAX_SENDS = 5;

export function emailCodesAvailable(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

type EmailQuestion = Extract<QuestionV1, { type: "email" }>;

export function needsVerification(question: QuestionV1): question is EmailQuestion {
  return question.type === "email" && question.settings.verify === true;
}

/** The form as respondents get it when codes can't be sent: no question
 * asks for one. */
export function withoutEmailVerification(schema: FormSchemaV1): FormSchemaV1 {
  if (!schema.questions.some(needsVerification)) return schema;
  return {
    ...schema,
    questions: schema.questions.map((q) =>
      needsVerification(q) ? { ...q, settings: { ...q.settings, verify: undefined } } : q,
    ),
  };
}

function hashCode(responseId: string, questionId: string, code: string, secret?: string) {
  return createHmac("sha256", signingKey("email-code", secret))
    .update(`${responseId}|${questionId}|${code}`)
    .digest("hex");
}

export type SendResult =
  | { ok: true }
  | { ok: false; code: "wait"; retryAfterSeconds: number; message: string }
  | {
      ok: false;
      code: "too_many" | "invalid" | "not_available" | "failed";
      message: string;
    };

/** Emails a new code for this response's question to `rawEmail`. */
export async function sendEmailCode(
  admin: Client,
  input: {
    responseId: string;
    question: EmailQuestion;
    email: unknown;
    formTitle: string;
    send?: Send | null;
    now?: Date;
    secret?: string;
  },
): Promise<SendResult> {
  const now = input.now ?? new Date();
  const send = input.send === undefined ? defaultSender() : input.send;
  if (!send) {
    return {
      ok: false,
      code: "not_available",
      message: "Codes can't be sent right now.",
    };
  }
  const email = cleanAddress(input.email);
  if (!email)
    return { ok: false, code: "invalid", message: "Enter a valid email address." };

  const { data: existing } = await admin
    .from("email_verifications")
    .select("sends, last_sent_at")
    .eq("response_id", input.responseId)
    .eq("question_id", input.question.id)
    .maybeSingle();
  if (existing) {
    const waited = now.getTime() - Date.parse(existing.last_sent_at);
    if (waited < RESEND_AFTER_MS) {
      const retryAfterSeconds = Math.ceil((RESEND_AFTER_MS - waited) / 1000);
      return {
        ok: false,
        code: "wait",
        retryAfterSeconds,
        message: `Wait ${retryAfterSeconds} seconds before asking for another code.`,
      };
    }
    if (existing.sends >= MAX_SENDS) {
      return {
        ok: false,
        code: "too_many",
        message: "Too many codes for this question. Use the last one we sent.",
      };
    }
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const row = {
    response_id: input.responseId,
    question_id: input.question.id,
    email,
    code_hash: hashCode(input.responseId, input.question.id, code, input.secret),
    expires_at: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
    attempts: 0,
    sends: (existing?.sends ?? 0) + 1,
    last_sent_at: now.toISOString(),
    verified_at: null,
  };
  const { error } = await admin
    .from("email_verifications")
    .upsert(row, { onConflict: "response_id,question_id" });
  if (error)
    return { ok: false, code: "failed", message: "Couldn't send a code. Try again." };

  const title = input.formTitle.trim() || "a form";
  const sent = await send({
    to: [email],
    // The code leads the subject, so it shows in the notification.
    subject: cleanSubject(`${code} is your code for ${title}`),
    text: `Your code is ${code}. Enter it on the form to confirm this email address. It expires in 10 minutes.\n\nIf you didn't ask for it, ignore this email.`,
    html: renderEmailHtml({
      tag: "Your code",
      tagColor: "#2b2118",
      title: code,
      body: `Enter this code on “${title}” to confirm this email address. It expires in 10 minutes.`,
      fine: "If you didn't ask for it, ignore this email: nothing happens without the code.",
      sentTo: email,
    }),
  });
  if (!sent.ok) {
    return { ok: false, code: "failed", message: "Couldn't send a code. Try again." };
  }
  return { ok: true };
}

export type CheckResult = { ok: true; email: string } | { ok: false; message: string };

/** Checks a code typed for this response's question. */
export async function checkEmailCode(
  admin: Client,
  input: {
    responseId: string;
    questionId: string;
    code: unknown;
    now?: Date;
    secret?: string;
  },
): Promise<CheckResult> {
  const now = input.now ?? new Date();
  const code = typeof input.code === "string" ? input.code.replace(/\s+/g, "") : "";
  if (!/^\d{6}$/.test(code)) return { ok: false, message: "Enter the 6-digit code." };

  const { data } = await admin.rpc("email_verification_attempt", {
    p_response_id: input.responseId,
    p_question_id: input.questionId,
  });
  const row = data?.[0];
  if (!row) return { ok: false, message: "Ask for a code first." };
  if (row.attempts > MAX_ATTEMPTS) {
    return { ok: false, message: "Too many wrong codes. Ask for a new one." };
  }
  if (Date.parse(row.expires_at) <= now.getTime()) {
    return { ok: false, message: "That code has expired. Ask for a new one." };
  }
  const expected = Buffer.from(row.code_hash, "hex");
  const given = Buffer.from(
    hashCode(input.responseId, input.questionId, code, input.secret),
    "hex",
  );
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    const left = MAX_ATTEMPTS - row.attempts;
    return {
      ok: false,
      message:
        left > 0
          ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.`
          : "That code isn't right. Ask for a new one.",
    };
  }
  await admin
    .from("email_verifications")
    .update({ verified_at: now.toISOString() })
    .eq("response_id", input.responseId)
    .eq("question_id", input.questionId);
  return { ok: true, email: row.email };
}

/** The addresses verified on a response, by question. */
export async function verifiedEmails(
  client: Client,
  responseId: string,
): Promise<Map<string, string>> {
  const { data } = await client
    .from("email_verifications")
    .select("question_id, email, verified_at")
    .eq("response_id", responseId)
    .not("verified_at", "is", null);
  return new Map((data ?? []).map((r) => [r.question_id, r.email]));
}
