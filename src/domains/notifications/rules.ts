import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { Condition } from "@/domains/forms/schema/logic-model";
import { renderRecall } from "@/domains/logic/recall";
import {
  answerLines,
  conditionHolds,
  loadResponseContext,
  type ResponseContext,
} from "@/domains/responses/context";
import { logResponseEvent } from "@/domains/responses/timeline";
import { DOCUMENT_KINDS } from "@/domains/documents/settings";
import {
  documentApplies,
  documentContent,
  documentFilename,
  issueNumber,
  listFormDocuments,
} from "@/domains/documents/issue";
import { renderDocumentPdf } from "@/domains/documents/pdf";
import { renderEmailHtml } from "./email-layout";
import {
  cleanAddress,
  cleanSubject,
  defaultSender,
  type OutgoingEmail,
  type Send,
} from "./mailer";

type Client = SupabaseClient<Database>;

/**
 * Notification rules (master spec F-25): emails to teammates about a
 * completed response — all of them, or only when its answers match a
 * condition — with a subject the creator writes (merge variables
 * allowed), the answers if they choose, and a PDF if they attach one.
 *
 * Recipients are workspace members who can see responses, nobody else
 * (product owner, 2026-10-30), so an answer can never route data to an
 * outside address. Merge values go into the subject as plain text (one
 * line, no control characters) and into the body escaped. Each send is
 * recorded on the response's timeline.
 */

export const NotificationRuleInput = z.object({
  name: z.string().trim().min(1, "Name the rule.").max(120),
  enabled: z.boolean(),
  memberIds: z.array(z.string().uuid()).min(1, "Choose at least one teammate.").max(20),
  condition: Condition.optional(),
  subject: z.string().max(200).optional(),
  includeAnswers: z.boolean(),
  attachDocument: z.enum(DOCUMENT_KINDS).optional(),
});
export type NotificationRuleInput = z.infer<typeof NotificationRuleInput>;

export type NotificationRule = NotificationRuleInput & { id: string };

export async function listNotificationRules(
  client: Client,
  formId: string,
): Promise<NotificationRule[]> {
  const { data } = await client
    .from("notification_rules")
    .select(
      "id, name, enabled, member_ids, condition, subject, include_answers, attach_document",
    )
    .eq("form_id", formId)
    .order("created_at");
  return (data ?? []).flatMap((r) => {
    const parsed = NotificationRuleInput.safeParse({
      name: r.name,
      enabled: r.enabled,
      memberIds: r.member_ids,
      condition: r.condition ?? undefined,
      subject: r.subject ?? undefined,
      includeAnswers: r.include_answers,
      attachDocument: r.attach_document ?? undefined,
    });
    return parsed.success ? [{ ...parsed.data, id: r.id }] : [];
  });
}

/** Whether the rule fires for this response. */
export function ruleMatches(
  rule: Pick<NotificationRule, "enabled" | "condition">,
  ctx: ResponseContext,
): boolean {
  if (!rule.enabled || ctx.status !== "completed") return false;
  return rule.condition ? conditionHolds(ctx, rule.condition) : true;
}

/** The subject with merge variables filled in: {{form}}, and recall
 * tokens ({{answer:…}}, {{score}}, URL fields). Plain text, one line. */
export function ruleSubject(template: string | undefined, ctx: ResponseContext): string {
  const base = template?.trim() || "New response: {{form}}";
  const withForm = base.replace(/\{\{\s*form\s*\}\}/g, ctx.form.title || "Untitled form");
  const filled = renderRecall(withForm, {
    schema: ctx.schema,
    answers: ctx.answers,
    variables: Object.fromEntries(
      (ctx.schema.variables ?? []).map((v) => [v.id, ctx.variables[v.id] ?? null]),
    ),
    hidden: ctx.hidden,
  });
  return cleanSubject(filled) || `New response: ${ctx.form.title}`;
}

/** Addresses of the rule's teammates who are still members and may see
 * responses. */
export async function ruleRecipients(
  admin: Client,
  workspaceId: string,
  memberIds: string[],
): Promise<string[]> {
  if (memberIds.length === 0) return [];
  const { data } = await admin
    .from("workspace_members")
    .select("user_id, role, permissions, profiles(email)")
    .eq("workspace_id", workspaceId)
    .in("user_id", memberIds);
  return [
    ...new Set(
      (data ?? [])
        .filter(
          (m) =>
            m.role === "owner" ||
            m.role === "admin" ||
            (m.permissions as Record<string, unknown> | null)?.view_responses !== false,
        )
        .map((m) => cleanAddress((m.profiles as { email: string } | null)?.email))
        .filter((e): e is string => e !== null),
    ),
  ];
}

const MAX_LINES = 60;
const MAX_VALUE = 500;

export function ruleEmail(
  rule: NotificationRule,
  ctx: ResponseContext,
  links: { response: string; settings: string },
): Omit<OutgoingEmail, "to" | "attachments"> {
  const subject = ruleSubject(rule.subject, ctx);
  const lines = rule.includeAnswers
    ? answerLines(ctx)
        .filter((l) => l.value)
        .slice(0, MAX_LINES)
        .map((l) => ({
          label: l.label.slice(0, 200),
          value:
            l.value.length > MAX_VALUE ? `${l.value.slice(0, MAX_VALUE - 1)}…` : l.value,
        }))
    : [];
  const body = rule.includeAnswers
    ? "A new response matched this notification. Its answers are below."
    : "A new response matched this notification. Open FormCraft to read it.";
  const html = renderEmailHtml({
    tag: "New response",
    tagColor: "#dcf1e3",
    title: subject,
    body,
    meta: [
      { label: "Form", value: ctx.form.title || "Untitled form" },
      { label: "Rule", value: rule.name },
      ...lines,
    ],
    button: { label: "View response", href: links.response },
    fine: `You're getting this because a teammate added you to the “${rule.name}” notification on this form.`,
    footerLink: { label: "Notification settings", href: links.settings },
  });
  const text = [
    subject,
    "",
    body,
    "",
    `Form: ${ctx.form.title}`,
    `Rule: ${rule.name}`,
    ...lines.map((l) => `${l.label}: ${l.value}`),
    "",
    `View response: ${links.response}`,
    `Notification settings: ${links.settings}`,
  ].join("\n");
  return { subject, html, text };
}

/**
 * Sends the form's matching rule emails for a just-completed response.
 * Called once per completion (the completion step runs only for the
 * request that completed it). Never throws.
 */
export async function sendRuleEmails(
  admin: Client,
  responseId: string,
  options: { send?: Send | null } = {},
): Promise<{ ruleId: string; sent: boolean }[]> {
  const out: { ruleId: string; sent: boolean }[] = [];
  try {
    const ctx = await loadResponseContext(admin, responseId);
    if (!ctx || ctx.status !== "completed") return out;
    const rules = (await listNotificationRules(admin, ctx.form.id)).filter((r) =>
      ruleMatches(r, ctx),
    );
    if (rules.length === 0) return out;
    const send = options.send === undefined ? defaultSender() : options.send;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const documents = rules.some((r) => r.attachDocument)
      ? await listFormDocuments(admin, ctx.form.id)
      : [];
    for (const rule of rules) {
      const log = (
        outcome: "ok" | "failed" | "skipped",
        extra: Record<string, string | number> = {},
      ) =>
        logResponseEvent(admin, {
          responseId,
          kind: "email_rule",
          outcome,
          detail: { rule: rule.name, ruleId: rule.id, ...extra },
        });
      const to = await ruleRecipients(admin, ctx.form.workspaceId, rule.memberIds);
      if (to.length === 0) {
        await log("skipped", { reason: "None of its teammates can receive it" });
        out.push({ ruleId: rule.id, sent: false });
        continue;
      }
      if (!send) {
        await log("skipped", { reason: "Email isn't set up on this server" });
        out.push({ ruleId: rule.id, sent: false });
        continue;
      }
      const email = ruleEmail(rule, ctx, {
        response: `${appUrl}/forms/${ctx.form.id}/responses/${responseId}`,
        settings: `${appUrl}/forms/${ctx.form.id}/integrations`,
      });
      const attachments: OutgoingEmail["attachments"] = [];
      const doc = documents.find((d) => d.kind === rule.attachDocument && d.enabled);
      if (doc && documentApplies(doc.kind, doc.settings, ctx)) {
        const issued = await issueNumber(admin, doc.id, responseId);
        const content = await documentContent(admin, ctx, doc, issued);
        attachments.push({
          filename: documentFilename(doc.kind, content.numberLabel),
          content: await renderDocumentPdf(content),
        });
      }
      const result = await send({ ...email, to, attachments });
      await log(
        result.ok ? "ok" : "failed",
        result.ok
          ? { recipients: to.length }
          : { reason: "The email service refused it" },
      );
      out.push({ ruleId: rule.id, sent: result.ok });
    }
  } catch {
    // Notifications follow the response; they never undo it.
  }
  return out;
}
