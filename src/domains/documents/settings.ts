import { z } from "zod";
import { Condition } from "@/domains/forms/schema/logic-model";
import { stableId } from "@/domains/forms/schema/primitives";

/**
 * PDF documents a form issues (master spec F-07) — settings shared by the
 * builder and the server. Product owner's choices (2026-10-30): numbers
 * are per form (and kind), with a prefix; certificates only when a
 * condition the creator sets holds; PDFs are rebuilt on demand, never
 * stored; extra recipients are workspace members only.
 *
 * Templates are ready-made: the creator edits the heading, text, footer,
 * logo, colour and number prefix — there's no free-form designer.
 */

export const DOCUMENT_KINDS = [
  "summary",
  "order",
  "registration",
  "certificate",
  // Master spec F-22 (2026-11-03): issued once a payment is confirmed.
  "receipt",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  summary: "Response summary",
  order: "Order confirmation",
  registration: "Registration confirmation",
  certificate: "Certificate",
  receipt: "Payment receipt",
};

export const DOCUMENT_KIND_HINT: Record<DocumentKind, string> = {
  summary: "Every answer, on submit.",
  order:
    "Items, quantities and total, on submit when there's an order. Says “paid” only once payment is confirmed.",
  registration: "A confirmation with a reference number, on submit.",
  certificate: "Issued only when the response meets the rule you set.",
  receipt:
    "What was paid, any coupon and the payment's reference, once the payment is confirmed. Not a tax invoice.",
};

export const DOCUMENT_RECIPIENTS = ["none", "owner", "respondent", "both"] as const;
export type DocumentRecipients = (typeof DOCUMENT_RECIPIENTS)[number];

export const DOCUMENT_RECIPIENTS_LABEL: Record<DocumentRecipients, string> = {
  none: "Nobody (download only)",
  owner: "The form owner",
  respondent: "The respondent",
  both: "The owner and the respondent",
};

const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => !v.includes("\u0000"))
    .optional();

export const DocumentSettings = z.object({
  heading: text(120),
  intro: text(1000),
  footer: text(300),
  /** An image uploaded to this workspace's form assets. */
  logoUrl: z.string().url().max(2000).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  /** Before the number: "INV-" → INV-0001. */
  numberPrefix: z
    .string()
    .regex(/^[A-Za-z0-9-]{0,12}$/)
    .optional(),
  /** Where the respondent's email address comes from (an email or
   * contact question). */
  emailQuestionId: stableId.optional(),
  /** Certificates: whose name goes on it (a text or contact question). */
  nameQuestionId: stableId.optional(),
  /** Certificates: reached one of these endings… */
  endingIds: z.array(stableId).max(20).optional(),
  /** …and/or this holds (e.g. score ≥ 80). */
  condition: Condition.optional(),
});
export type DocumentSettings = z.infer<typeof DocumentSettings>;

export const DEFAULT_HEADING: Record<DocumentKind, string> = {
  summary: "Response summary",
  order: "Order confirmation",
  registration: "Registration confirmed",
  certificate: "Certificate of completion",
  receipt: "Payment receipt",
};

export function parseDocumentSettings(raw: unknown): DocumentSettings {
  const parsed = DocumentSettings.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/** "INV-0042" */
export function documentNumber(settings: DocumentSettings, number: number): string {
  return `${settings.numberPrefix ?? ""}${String(number).padStart(4, "0")}`;
}

/** A certificate needs a rule: without one it's never issued. */
export function certificateHasRule(settings: DocumentSettings): boolean {
  return Boolean(settings.condition) || (settings.endingIds?.length ?? 0) > 0;
}
