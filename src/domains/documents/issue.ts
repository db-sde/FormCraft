import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  answerLines,
  conditionHolds,
  loadResponseContext,
  type ResponseContext,
} from "@/domains/responses/context";
import { logResponseEvent } from "@/domains/responses/timeline";
import { renderEmailHtml } from "@/domains/notifications/email-layout";
import { cleanAddress, defaultSender, type Send } from "@/domains/notifications/mailer";
import { renderDocumentPdf, type DocumentContent } from "./pdf";
import {
  certificateHasRule,
  DEFAULT_HEADING,
  DOCUMENT_KIND_LABEL,
  documentNumber,
  parseDocumentSettings,
  type DocumentKind,
  type DocumentSettings,
} from "./settings";

type Client = SupabaseClient<Database>;

/**
 * Issuing documents (master spec F-07): which of a form's documents a
 * completed response gets, its number (fixed once given, per form and
 * kind), the PDF (rebuilt on demand, never stored) and the email to the
 * chosen recipients, sent at most once and recorded on the response's
 * timeline either way.
 */

export type FormDocument = {
  id: string;
  kind: DocumentKind;
  enabled: boolean;
  settings: DocumentSettings;
  recipients: "owner" | "respondent" | "both" | "none";
  memberIds: string[];
};

export async function listFormDocuments(
  client: Client,
  formId: string,
): Promise<FormDocument[]> {
  const { data } = await client
    .from("form_documents")
    .select("id, kind, enabled, settings, recipients, member_ids")
    .eq("form_id", formId);
  return (data ?? []).map((d) => ({
    id: d.id,
    kind: d.kind,
    enabled: d.enabled,
    settings: parseDocumentSettings(d.settings),
    recipients: d.recipients,
    memberIds: d.member_ids,
  }));
}

/** Whether a completed response gets this document. A certificate needs
 * its rule to hold — no rule, no certificate; an order confirmation
 * needs an order. */
export function documentApplies(
  kind: DocumentKind,
  settings: DocumentSettings,
  ctx: Pick<ResponseContext, "status" | "order" | "endingId"> & Partial<ResponseContext>,
): boolean {
  if (ctx.status !== "completed") return false;
  switch (kind) {
    case "summary":
    case "registration":
      return true;
    case "order":
      return Boolean(ctx.order && ctx.order.lines.length > 0);
    case "certificate": {
      if (!certificateHasRule(settings)) return false;
      if (settings.endingIds?.length && !settings.endingIds.includes(ctx.endingId ?? ""))
        return false;
      if (settings.condition) {
        if (!ctx.answers) return false;
        return conditionHolds(ctx as ResponseContext, settings.condition);
      }
      return true;
    }
  }
}

/** What the order's payment state says. Never "Paid" unless it is. */
export function paymentLabel(payment: { status: string } | null): {
  label: string;
  paid: boolean;
} {
  if (payment?.status === "paid") return { label: "Paid", paid: true };
  if (payment?.status === "pending")
    return { label: "Payment due: not paid yet", paid: false };
  if (payment) return { label: "Not paid", paid: false };
  return { label: "Not paid online", paid: false };
}

function issuedDate(iso: string, timeZone: string | undefined) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "long",
      timeZone: timeZone || "UTC",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

async function download(admin: Client, bucket: string, path: string) {
  const { data } = await admin.storage.from(bucket).download(path);
  if (!data || data.size > 2 * 1024 * 1024) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/** The logo, only from this app's own theme-assets bucket. */
async function loadLogo(admin: Client, url: string | undefined) {
  if (!url) return undefined;
  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/storage/v1/object/public/theme-assets/`;
  if (!base.startsWith("http") || !url.startsWith(base)) return undefined;
  const path = decodeURIComponent(url.slice(base.length).split("?")[0]);
  const bytes = await download(admin, "theme-assets", path);
  if (!bytes) return undefined;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50;
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  return png
    ? { bytes, type: "png" as const }
    : jpg
      ? { bytes, type: "jpg" as const }
      : undefined;
}

function personName(ctx: ResponseContext, questionId: string | undefined): string {
  if (!questionId) return "";
  const q = ctx.schema.questions.find((x) => x.id === questionId);
  const value = ctx.answers[questionId];
  if (q?.type === "contact_info") {
    const name = (value as { name?: unknown } | null)?.name;
    return typeof name === "string" ? name.trim().slice(0, 120) : "";
  }
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

/** The PDF's content for a response. */
export async function documentContent(
  admin: Client,
  ctx: ResponseContext,
  doc: Pick<FormDocument, "kind" | "settings">,
  issued: { number: number; issuedAt: string },
): Promise<DocumentContent> {
  const s = doc.settings;
  const rows: DocumentContent["rows"] = [];
  if (doc.kind === "summary" || doc.kind === "registration" || doc.kind === "order") {
    for (const line of answerLines(ctx)) {
      // The order has its own table.
      if (doc.kind === "order" && line.question.type === "products") continue;
      if (line.question.type === "signature") {
        const upload = ctx.uploads.get(String(ctx.answers[line.question.id] ?? ""));
        const signature = upload
          ? await download(admin, "response-uploads", upload.storagePath)
          : null;
        rows.push({
          label: line.label,
          value: upload
            ? `Signed ${issuedDate(upload.createdAt, ctx.schema.meta.timezone)} · electronic signature, not certified`
            : "Not signed",
          signature: signature ?? undefined,
        });
        continue;
      }
      rows.push({ label: line.label, value: line.value });
    }
  }
  const payment = paymentLabel(ctx.payment);
  return {
    kind: doc.kind,
    heading: s.heading?.trim() || DEFAULT_HEADING[doc.kind],
    intro: s.intro?.trim() || undefined,
    footer: s.footer?.trim() || undefined,
    color: s.color ?? ctx.schema.theme.primaryColor,
    logo: await loadLogo(admin, s.logoUrl),
    formTitle: ctx.form.title,
    numberLabel: documentNumber(s, issued.number),
    issuedAt: issuedDate(issued.issuedAt, ctx.schema.meta.timezone),
    rows,
    ...(doc.kind === "order" && ctx.order
      ? {
          order: {
            currency: ctx.order.currency,
            lines: ctx.order.lines,
            total: ctx.order.total,
            paymentLabel: payment.label,
            paid: payment.paid,
          },
        }
      : {}),
    ...(doc.kind === "certificate"
      ? { certificate: { name: personName(ctx, s.nameQuestionId) } }
      : {}),
  };
}

export async function issueNumber(admin: Client, documentId: string, responseId: string) {
  const { data, error } = await admin.rpc("issue_response_document", {
    p_document_id: documentId,
    p_response_id: responseId,
  });
  if (error || !data?.[0]) throw error ?? new Error("document not issued");
  return {
    id: data[0].id,
    number: data[0].number,
    issuedAt: data[0].issued_at,
    emailedAt: data[0].emailed_at,
  };
}

export function documentFilename(kind: DocumentKind, numberLabel: string) {
  return `${DOCUMENT_KIND_LABEL[kind].toLowerCase().replace(/\s+/g, "-")}-${numberLabel}.pdf`;
}

/** Recipients' addresses: the owner, the respondent (from the chosen
 * question), and teammates — workspace members only. */
async function recipientsFor(
  admin: Client,
  ctx: ResponseContext,
  doc: FormDocument,
): Promise<string[]> {
  const out = new Set<string>();
  const wantsOwner = doc.recipients === "owner" || doc.recipients === "both";
  const wantsRespondent = doc.recipients === "respondent" || doc.recipients === "both";
  if (wantsOwner || doc.memberIds.length) {
    const { data: members } = await admin
      .from("workspace_members")
      .select("user_id, role, permissions, profiles(email)")
      .eq("workspace_id", ctx.form.workspaceId);
    for (const m of members ?? []) {
      const email = cleanAddress((m.profiles as { email: string } | null)?.email);
      if (!email) continue;
      // Teammates get answers only if they may see responses.
      const seesResponses =
        m.role === "owner" ||
        m.role === "admin" ||
        (m.permissions as Record<string, unknown> | null)?.view_responses !== false;
      if (
        (wantsOwner && m.role === "owner") ||
        (seesResponses && doc.memberIds.includes(m.user_id))
      )
        out.add(email);
    }
  }
  if (wantsRespondent && doc.settings.emailQuestionId) {
    const q = ctx.schema.questions.find((x) => x.id === doc.settings.emailQuestionId);
    const raw = ctx.answers[doc.settings.emailQuestionId];
    const email = cleanAddress(
      q?.type === "contact_info" ? (raw as { email?: unknown } | null)?.email : raw,
    );
    if (email) out.add(email);
  }
  return [...out].slice(0, 25);
}

/**
 * Issues every document a just-completed response qualifies for and
 * emails the ones with recipients. Safe to call more than once: numbers
 * and the "emailed" mark are claimed in the database, so a repeat
 * (duplicate submit, retry) never renumbers or resends. Never throws.
 */
export async function issueDocumentsForResponse(
  admin: Client,
  responseId: string,
  options: { send?: Send | null } = {},
): Promise<{ kind: DocumentKind; number: number; emailed: boolean }[]> {
  const issued: { kind: DocumentKind; number: number; emailed: boolean }[] = [];
  try {
    const ctx = await loadResponseContext(admin, responseId);
    if (!ctx || ctx.status !== "completed") return issued;
    const docs = (await listFormDocuments(admin, ctx.form.id)).filter((d) => d.enabled);
    const send = options.send === undefined ? defaultSender() : options.send;
    for (const doc of docs) {
      if (!documentApplies(doc.kind, doc.settings, ctx)) continue;
      const number = await issueNumber(admin, doc.id, responseId);
      let emailed = false;
      if (doc.recipients !== "none" || doc.memberIds.length > 0) {
        emailed = await emailDocument(admin, ctx, doc, number, send);
      }
      issued.push({ kind: doc.kind, number: number.number, emailed });
    }
  } catch {
    // Documents follow the response; they never undo it.
  }
  return issued;
}

async function emailDocument(
  admin: Client,
  ctx: ResponseContext,
  doc: FormDocument,
  issued: { id: string; number: number; issuedAt: string; emailedAt: string | null },
  send: Send | null,
): Promise<boolean> {
  if (issued.emailedAt) return false;
  const label = DOCUMENT_KIND_LABEL[doc.kind];
  const log = (outcome: "ok" | "failed" | "skipped", reason?: string) =>
    logResponseEvent(admin, {
      responseId: ctx.id,
      kind: "document_emailed",
      outcome,
      detail: { document: doc.kind, ...(reason ? { reason } : {}) },
    });
  const to = await recipientsFor(admin, ctx, doc);
  if (to.length === 0) {
    await log("skipped", "No one to send it to");
    return false;
  }
  if (!send) {
    await log("skipped", "Email isn't set up on this server");
    return false;
  }
  // Claim the send: a racing or repeated call stops here.
  const { data: claimed } = await admin
    .from("response_documents")
    .update({ emailed_at: new Date().toISOString() })
    .eq("id", issued.id)
    .is("emailed_at", null)
    .select("id");
  if (!claimed?.length) return false;

  const content = await documentContent(admin, ctx, doc, issued);
  const pdf = await renderDocumentPdf(content);
  const title = `${content.heading} · ${content.numberLabel}`;
  const body = `Attached: ${label.toLowerCase()} ${content.numberLabel} for “${ctx.form.title}”.`;
  const result = await send({
    to,
    subject: `${content.heading}: ${ctx.form.title}`.slice(0, 200),
    html: renderEmailHtml({
      tag: label,
      tagColor: "#e4ecfb",
      title,
      body,
      fine: "This PDF was created from a form response.",
    }),
    text: `${title}\n\n${body}\n`,
    attachments: [
      { filename: documentFilename(doc.kind, content.numberLabel), content: pdf },
    ],
  });
  if (!result.ok) {
    // Release the claim so a later retry can send it.
    await admin
      .from("response_documents")
      .update({ emailed_at: null })
      .eq("id", issued.id);
    await log("failed", "The email service refused it");
    return false;
  }
  await log("ok");
  return true;
}
