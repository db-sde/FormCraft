import type { SupabaseClient } from "@supabase/supabase-js";
import { featureEnabled } from "@/domains/flags";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { Entitlements } from "@/domains/billing/entitlements";
import type { ResponseContext } from "@/domains/responses/context";
import { answerLines } from "@/domains/responses/context";
import { formatAnswerValue } from "@/domains/responses/format";
import { EmailTemplate, type TemplateKind } from "./schema";
import type { MergeContext } from "./render";

type Client = SupabaseClient<Database>;

export type TemplateTarget =
  | { kind: "confirmation" | "owner_notification"; formId: string }
  | { kind: "rule"; ruleId: string }
  | { kind: "booking_confirmation" | "booking_reminder"; bookingTypeId: string };

export type StoredTemplate = {
  id: string;
  template: EmailTemplate;
  updatedAt: string;
};

function scope(target: TemplateTarget) {
  return {
    form_id: "formId" in target ? target.formId : null,
    rule_id: "ruleId" in target ? target.ruleId : null,
    booking_type_id: "bookingTypeId" in target ? target.bookingTypeId : null,
  };
}

function fromRow(row: {
  subject: string;
  preheader: string | null;
  sender_name: string | null;
  reply_to: Json;
  body: Json;
}): EmailTemplate | null {
  const body = (row.body ?? {}) as Record<string, unknown>;
  const parsed = EmailTemplate.safeParse({
    subject: row.subject,
    preheader: row.preheader ?? undefined,
    senderName: row.sender_name ?? undefined,
    replyTo: row.reply_to,
    blocks: body.blocks,
    brand: body.brand ?? {},
    attachPdf: body.attachPdf,
  });
  return parsed.success ? parsed.data : null;
}

/** A target's saved template, or null (the standard email is used). */
export async function getTemplate(
  supabase: Client,
  workspaceId: string,
  target: TemplateTarget,
): Promise<StoredTemplate | null> {
  const s = scope(target);
  let query = supabase
    .from("email_templates")
    .select("id, subject, preheader, sender_name, reply_to, body, updated_at")
    .eq("workspace_id", workspaceId)
    .eq("kind", target.kind);
  query = s.form_id ? query.eq("form_id", s.form_id) : query;
  query = s.rule_id ? query.eq("rule_id", s.rule_id) : query;
  query = s.booking_type_id ? query.eq("booking_type_id", s.booking_type_id) : query;
  const { data } = await query.maybeSingle();
  if (!data) return null;
  const template = fromRow(data);
  return template ? { id: data.id, template, updatedAt: data.updated_at } : null;
}

/** Saves a target's template (the caller has checked plan and role; the
 * database checks the role and the target's workspace again). */
export async function saveTemplate(
  supabase: Client,
  input: {
    workspaceId: string;
    target: TemplateTarget;
    template: EmailTemplate;
    userId: string;
    renderedHtml?: string;
  },
): Promise<string> {
  const existing = await getTemplate(supabase, input.workspaceId, input.target);
  const row = {
    workspace_id: input.workspaceId,
    kind: input.target.kind,
    ...scope(input.target),
    subject: input.template.subject,
    preheader: input.template.preheader || null,
    sender_name: input.template.senderName || null,
    reply_to: input.template.replyTo as unknown as Json,
    body: {
      blocks: input.template.blocks,
      brand: input.template.brand,
      attachPdf: input.template.attachPdf ?? false,
    } as unknown as Json,
    rendered_html_cache: input.renderedHtml?.slice(0, 200_000) ?? null,
    updated_by: input.userId,
  };
  if (existing) {
    const { error } = await supabase
      .from("email_templates")
      .update(row)
      .eq("id", existing.id);
    if (error) throw error;
    return existing.id;
  }
  const { data, error } = await supabase
    .from("email_templates")
    .insert(row)
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Reset to default: the template is removed; the standard email is sent. */
export async function deleteTemplate(
  supabase: Client,
  workspaceId: string,
  target: TemplateTarget,
): Promise<void> {
  const existing = await getTemplate(supabase, workspaceId, target);
  if (!existing) return;
  const { error } = await supabase.from("email_templates").delete().eq("id", existing.id);
  if (error) throw error;
}

export type SavedTemplate = { id: string; name: string; template: EmailTemplate };

/** The workspace's saved templates ("Save as workspace template"). */
export async function listSavedTemplates(
  supabase: Client,
  workspaceId: string,
): Promise<SavedTemplate[]> {
  const { data } = await supabase
    .from("email_templates")
    .select("id, name, subject, preheader, sender_name, reply_to, body")
    .eq("workspace_id", workspaceId)
    .eq("kind", "saved")
    .order("updated_at", { ascending: false })
    .limit(50);
  return (data ?? []).flatMap((row) => {
    const template = fromRow(row);
    return template ? [{ id: row.id, name: row.name ?? "Template", template }] : [];
  });
}

export async function saveWorkspaceTemplate(
  supabase: Client,
  input: { workspaceId: string; name: string; template: EmailTemplate; userId: string },
): Promise<string> {
  const { data, error } = await supabase
    .from("email_templates")
    .insert({
      workspace_id: input.workspaceId,
      kind: "saved",
      name: input.name,
      subject: input.template.subject,
      preheader: input.template.preheader || null,
      sender_name: input.template.senderName || null,
      reply_to: input.template.replyTo as unknown as Json,
      body: {
        blocks: input.template.blocks,
        brand: input.template.brand,
        attachPdf: input.template.attachPdf ?? false,
      } as unknown as Json,
      updated_by: input.userId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** The template to send with, when the plan includes custom templates
 * (a downgraded workspace keeps its templates; they stop applying). */
export async function templateForSend(
  admin: Client,
  workspaceId: string,
  target: TemplateTarget,
  entitlements: Entitlements,
): Promise<StoredTemplate | null> {
  if (!entitlements.email_templates) return null;
  if (!(await featureEnabled("email_templates", workspaceId, admin))) return null;
  try {
    return await getTemplate(admin, workspaceId, target);
  } catch {
    return null;
  }
}

/** A response's values for merge tags. */
export function mergeContextFromResponse(ctx: ResponseContext): MergeContext {
  const uploadNames = new Map([...ctx.uploads].map(([id, u]) => [id, u.name]));
  const answers: Record<string, string> = {};
  for (const q of ctx.schema.questions) {
    if (ctx.answers[q.id] === undefined) continue;
    answers[q.id] = formatAnswerValue(q, ctx.answers[q.id], { uploadNames });
  }
  let respondentEmail: string | undefined;
  for (const q of ctx.path) {
    const v = ctx.answers[q.id];
    if (q.type === "email" && typeof v === "string") respondentEmail = v;
    else if (
      q.type === "contact_info" &&
      typeof (v as { email?: unknown })?.email === "string"
    )
      respondentEmail = (v as { email: string }).email;
    if (respondentEmail) break;
  }
  const scoreVar = ctx.schema.variables?.find(
    (v) => v.id === "score" || v.name?.toLowerCase() === "score",
  );
  const score = scoreVar ? ctx.variables[scoreVar.id] : undefined;
  const ending = ctx.schema.endings.find((e) => e.id === ctx.endingId);
  return {
    formTitle: ctx.form.title || ctx.schema.meta.title,
    responseId: ctx.id,
    submittedAt: ctx.completedAt ?? undefined,
    answers,
    hidden: ctx.hidden,
    score: score === undefined || score === null ? undefined : String(score),
    ending: ending?.title,
    respondentEmail,
    answerLines: answerLines(ctx).map((l) => ({ label: l.label, value: l.value })),
  };
}

export type { TemplateKind };
