import { Resend } from "resend";

/**
 * One way to send an email, for the Phase 3 senders (documents, rule
 * emails, digests). Tests pass their own `send`; without an API key
 * nothing is sent and the caller records why.
 */

export type OutgoingEmail = {
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Uint8Array }[];
};

export type Send = (
  email: OutgoingEmail,
) => Promise<{ ok: true; id?: string } | { ok: false }>;

/** Resend, when configured; null otherwise. */
export function defaultSender(): Send | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return async (email) => {
    try {
      const { data, error } = await new Resend(key).emails.send({
        from: process.env.EMAIL_FROM ?? "FormCraft <notifications@formcraft.local>",
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        attachments: email.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content),
        })),
      });
      return error ? { ok: false } : { ok: true, id: data?.id };
    } catch {
      return { ok: false };
    }
  };
}

export const EMAIL_ADDRESS = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

/** A single, well-formed address, or null — never a list someone typed
 * into an answer to reach other people. */
export function cleanAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  return email.length <= 254 && EMAIL_ADDRESS.test(email) ? email.toLowerCase() : null;
}

/** A subject line: one line, no control characters, at most 200 chars. */
export function cleanSubject(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
