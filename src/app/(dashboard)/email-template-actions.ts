"use server";

import { SWITCHED_OFF, featureEnabled } from "@/domains/flags";
import { z } from "zod";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { canEdit } from "@/domains/workspaces";
import { hasPermission } from "@/domains/workspaces/permissions";
import { planBlocks } from "@/domains/billing/entitlements";
import { recordAudit } from "@/domains/audit/record";
import { rateLimit } from "@/domains/abuse/limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLatestSchema } from "@/domains/responses/dashboard";
import { loadResponseContext } from "@/domains/responses/context";
import { isOwnUpload } from "@/domains/forms/seo";
import { defaultSender } from "@/domains/notifications/mailer";
import {
  EmailTemplate,
  defaultTemplate,
  mergeTagsFor,
  type TemplateKind,
} from "@/domains/email-templates/schema";
import {
  deleteTemplate,
  getTemplate,
  listSavedTemplates,
  mergeContextFromResponse,
  saveTemplate,
  saveWorkspaceTemplate,
  type SavedTemplate,
  type TemplateTarget,
} from "@/domains/email-templates/queries";
import {
  renderTemplate,
  sampleContext,
  type MergeContext,
} from "@/domains/email-templates/render";
import { renderForSend } from "@/domains/email-templates/send";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";

const Target = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["confirmation", "owner_notification"]),
    formId: z.string().uuid(),
  }),
  z.object({ kind: z.literal("rule"), ruleId: z.string().uuid() }),
  z.object({
    kind: z.enum(["booking_confirmation", "booking_reminder"]),
    bookingTypeId: z.string().uuid(),
  }),
]);

type Ctx = Awaited<ReturnType<typeof getCurrentWorkspace>>;

/** The target, if it's in the current workspace, with its form. */
async function resolve(
  ctx: Ctx,
  raw: unknown,
): Promise<{
  target: TemplateTarget;
  formId: string | null;
  schema: FormSchemaV1 | null;
  ruleHasPdf: boolean;
} | null> {
  const parsed = Target.safeParse(raw);
  if (!parsed.success) return null;
  const target = parsed.data as TemplateTarget;
  const { supabase, workspace } = ctx;
  let formId: string | null = null;
  let ruleHasPdf = false;
  if ("formId" in target) {
    const { data } = await supabase
      .from("forms")
      .select("id")
      .eq("id", target.formId)
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!data) return null;
    formId = data.id;
  } else if ("ruleId" in target) {
    const { data } = await supabase
      .from("notification_rules")
      .select("id, form_id, attach_document, forms!inner(workspace_id)")
      .eq("id", target.ruleId)
      .eq("forms.workspace_id", workspace.id)
      .maybeSingle();
    if (!data) return null;
    formId = data.form_id;
    ruleHasPdf = Boolean(data.attach_document);
  } else {
    const { data } = await supabase
      .from("booking_types")
      .select("id")
      .eq("id", target.bookingTypeId)
      .eq("workspace_id", workspace.id)
      .maybeSingle();
    if (!data) return null;
  }
  const schema = formId ? await getLatestSchema(supabase, formId) : null;
  return { target, formId, schema, ruleHasPdf };
}

export type TemplateEditorData = {
  kind: TemplateKind;
  template: EmailTemplate;
  isCustom: boolean;
  allowed: boolean;
  planMessage: string | null;
  canManage: boolean;
  mergeTags: { tag: string; label: string }[];
  questions: { id: string; label: string; isEmail: boolean }[];
  hiddenFields: string[];
  ruleHasPdf: boolean;
  saved: SavedTemplate[];
  workspaceId: string;
  formId: string | null;
};

export async function loadTemplateEditorAction(
  raw: unknown,
): Promise<{ ok: true; data: TemplateEditorData } | { ok: false; message: string }> {
  const ctx = await getCurrentWorkspace();
  const r = await resolve(ctx, raw);
  if (!r) return { ok: false, message: "Not found." };
  const [stored, planMessage, canManage, saved] = await Promise.all([
    getTemplate(ctx.supabase, ctx.workspace.id, r.target),
    planBlocks(ctx.supabase, ctx.workspace.id, "email_templates"),
    hasPermission(ctx.supabase, ctx.workspace.id, "manage_integrations"),
    listSavedTemplates(ctx.supabase, ctx.workspace.id),
  ]);
  const questions = (r.schema?.questions ?? [])
    .filter((q) => !["welcome_screen", "statement"].includes(q.type))
    .map((q) => ({
      id: q.id,
      label: q.label.trim() || "Untitled question",
      isEmail:
        q.type === "email" ||
        (q.type === "contact_info" &&
          ((q.settings as { fields?: string[] }).fields?.includes("email") ?? false)),
    }));
  return {
    ok: true,
    data: {
      kind: r.target.kind,
      template: stored?.template ?? defaultTemplate(r.target.kind),
      isCustom: Boolean(stored),
      allowed: !planMessage,
      planMessage,
      canManage: canManage && canEdit(ctx.workspace.role),
      mergeTags: mergeTagsFor(r.target.kind),
      questions,
      hiddenFields: (r.schema?.hiddenFields ?? []).map((h) => h.name),
      ruleHasPdf: r.ruleHasPdf,
      saved,
      workspaceId: ctx.workspace.id,
      formId: r.formId,
    },
  };
}

function checkTemplate(
  raw: unknown,
  workspaceId: string,
): { ok: true; template: EmailTemplate } | { ok: false; message: string } {
  const parsed = EmailTemplate.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check the template.",
    };
  }
  const images = [
    ...parsed.data.blocks.flatMap((b) => (b.type === "image" ? [b.url] : [])),
    ...(parsed.data.brand.logoUrl ? [parsed.data.brand.logoUrl] : []),
  ];
  if (images.some((url) => !isOwnUpload(url, workspaceId))) {
    return {
      ok: false,
      message: "Upload images here rather than linking to another site.",
    };
  }
  return { ok: true, template: parsed.data };
}

async function mayChange(ctx: Ctx): Promise<string | null> {
  if (!canEdit(ctx.workspace.role)) return "You have view-only access to this workspace.";
  if (!(await hasPermission(ctx.supabase, ctx.workspace.id, "manage_integrations")))
    return "You don't have permission to change this form's emails.";
  const blocked = await planBlocks(ctx.supabase, ctx.workspace.id, "email_templates");
  if (blocked) return blocked;
  return (await featureEnabled("email_templates", ctx.workspace.id))
    ? null
    : SWITCHED_OFF;
}

async function mergeFor(
  ctx: Ctx,
  r: NonNullable<Awaited<ReturnType<typeof resolve>>>,
): Promise<MergeContext> {
  const title = r.schema?.meta.title ?? "Your form";
  const sample = sampleContext(
    title,
    (r.schema?.questions ?? []).map((q) => ({ id: q.id, label: q.label })),
  );
  if (!r.formId) return sample;
  // The latest completed response, when the person may see responses.
  if (!(await hasPermission(ctx.supabase, ctx.workspace.id, "view_responses")))
    return sample;
  const { data } = await ctx.supabase
    .from("responses")
    .select("id")
    .eq("form_id", r.formId)
    .eq("status", "completed")
    .eq("is_preview", false)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return sample;
  const response = await loadResponseContext(createAdminClient(), data.id);
  return response ? { ...sample, ...mergeContextFromResponse(response) } : sample;
}

export async function saveTemplateAction(
  raw: unknown,
  rawTemplate: unknown,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await getCurrentWorkspace();
  const r = await resolve(ctx, raw);
  if (!r) return { ok: false, message: "Not found." };
  const denied = await mayChange(ctx);
  if (denied) return { ok: false, message: denied };
  const checked = checkTemplate(rawTemplate, ctx.workspace.id);
  if (!checked.ok) return checked;
  const sample = sampleContext(
    r.schema?.meta.title ?? "Your form",
    (r.schema?.questions ?? []).map((q) => ({ id: q.id, label: q.label })),
  );
  const preview = renderTemplate(checked.template, sample, {
    accent: r.schema?.theme.primaryColor ?? "#f2b233",
    logoUrl: r.schema?.theme.logoUrl,
    ownerName: ctx.workspace.name,
    footerReason: "",
  });
  try {
    const id = await saveTemplate(ctx.supabase, {
      workspaceId: ctx.workspace.id,
      target: r.target,
      template: checked.template,
      userId: ctx.user.id,
      renderedHtml: preview.html,
    });
    await recordAudit({
      workspaceId: ctx.workspace.id,
      actorId: ctx.user.id,
      action: "email_template.saved",
      target: { type: "email_template", id },
      metadata: { kind: r.target.kind },
    });
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't save the template." };
  }
}

export async function resetTemplateAction(
  raw: unknown,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await getCurrentWorkspace();
  const r = await resolve(ctx, raw);
  if (!r) return { ok: false, message: "Not found." };
  if (
    !canEdit(ctx.workspace.role) ||
    !(await hasPermission(ctx.supabase, ctx.workspace.id, "manage_integrations"))
  ) {
    return {
      ok: false,
      message: "You don't have permission to change this form's emails.",
    };
  }
  try {
    await deleteTemplate(ctx.supabase, ctx.workspace.id, r.target);
    await recordAudit({
      workspaceId: ctx.workspace.id,
      actorId: ctx.user.id,
      action: "email_template.reset",
      target: { type: r.target.kind, id: Object.values(r.target)[1] as string },
    });
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't reset it." };
  }
}

/** The email as it would be sent, with the latest response or sample
 * answers. */
export async function previewTemplateAction(
  raw: unknown,
  rawTemplate: unknown,
): Promise<
  | { ok: true; subject: string; html: string; text: string }
  | { ok: false; message: string }
> {
  const ctx = await getCurrentWorkspace();
  const r = await resolve(ctx, raw);
  if (!r) return { ok: false, message: "Not found." };
  const checked = checkTemplate(rawTemplate, ctx.workspace.id);
  if (!checked.ok) return checked;
  const merge = await mergeFor(ctx, r);
  const out = renderTemplate(checked.template, merge, {
    accent: r.schema?.theme.primaryColor ?? "#f2b233",
    logoUrl: r.schema?.theme.logoUrl,
    ownerName: ctx.workspace.name,
    footerReason: "This is a preview.",
  });
  return { ok: true, subject: out.subject, html: out.html, text: out.text };
}

/** Sends the template to the current user: 10 an hour each, not counted
 * against the workspace's emails. */
export async function sendTestTemplateAction(
  raw: unknown,
  rawTemplate: unknown,
): Promise<{ ok: true; to: string } | { ok: false; message: string }> {
  const ctx = await getCurrentWorkspace();
  const r = await resolve(ctx, raw);
  if (!r) return { ok: false, message: "Not found." };
  const denied = await mayChange(ctx);
  if (denied) return { ok: false, message: denied };
  const checked = checkTemplate(rawTemplate, ctx.workspace.id);
  if (!checked.ok) return checked;
  const to = ctx.user.email;
  if (!to) return { ok: false, message: "Your account has no email address." };
  if (!(await rateLimit(`email-test:${ctx.user.id}`, 10, 3_600_000)).allowed) {
    return { ok: false, message: "That's 10 test emails this hour. Try again later." };
  }
  const send = defaultSender();
  if (!send) return { ok: false, message: "Email isn't set up on this server." };
  const email = await renderForSend(createAdminClient(), {
    workspaceId: ctx.workspace.id,
    stored: { id: "test", template: checked.template, updatedAt: "" },
    merge: await mergeFor(ctx, r),
    theme: r.schema?.theme,
    footerReason: "This is a test you sent yourself.",
  });
  const result = await send({ ...email, subject: `[Test] ${email.subject}`, to: [to] });
  return result.ok
    ? { ok: true, to }
    : { ok: false, message: "The email service refused it." };
}

export async function saveWorkspaceTemplateAction(
  name: string,
  rawTemplate: unknown,
): Promise<{ ok: true; saved: SavedTemplate } | { ok: false; message: string }> {
  const ctx = await getCurrentWorkspace();
  const parsedName = z.string().trim().min(1).max(60).safeParse(name);
  if (!parsedName.success)
    return { ok: false, message: "Name it (up to 60 characters)." };
  const denied = await mayChange(ctx);
  if (denied) return { ok: false, message: denied };
  const checked = checkTemplate(rawTemplate, ctx.workspace.id);
  if (!checked.ok) return checked;
  try {
    const id = await saveWorkspaceTemplate(ctx.supabase, {
      workspaceId: ctx.workspace.id,
      name: parsedName.data,
      template: checked.template,
      userId: ctx.user.id,
    });
    await recordAudit({
      workspaceId: ctx.workspace.id,
      actorId: ctx.user.id,
      action: "email_template.saved",
      target: { type: "email_template", id },
      metadata: { kind: "saved", name: parsedName.data },
    });
    return { ok: true, saved: { id, name: parsedName.data, template: checked.template } };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error && error.message.includes("50 saved")
          ? "A workspace can keep up to 50 saved templates."
          : "Couldn't save it.",
    };
  }
}
