"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { canEdit } from "@/domains/workspaces";
import { parseFormSchema } from "@/domains/forms/schema";
import { assignableMembers } from "@/domains/responses/records";
import {
  certificateHasRule,
  DOCUMENT_KINDS,
  DOCUMENT_RECIPIENTS,
  DocumentSettings,
} from "@/domains/documents/settings";
import type { Json } from "@/lib/supabase/database.types";

type Result = { ok: true } | { ok: false; message: string };

const DocumentInput = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  enabled: z.boolean(),
  settings: DocumentSettings,
  recipients: z.enum(DOCUMENT_RECIPIENTS),
  memberIds: z.array(z.string().uuid()).max(20),
});
export type DocumentInput = z.input<typeof DocumentInput>;

/** The form, if the caller may edit it, and its latest draft. */
async function editable(formId: string) {
  const { supabase, workspace } = await getCurrentWorkspace();
  if (!canEdit(workspace.role)) return null;
  const { data: form } = await supabase
    .from("forms")
    .select("id")
    .eq("id", formId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!form) return null;
  const { data: draft } = await supabase
    .from("form_versions")
    .select("schema")
    .eq("form_id", formId)
    .eq("status", "draft")
    .maybeSingle();
  return {
    supabase,
    workspace,
    schema: draft ? parseFormSchema(draft.schema) : null,
  };
}

/**
 * Sets up (or changes) one of a form's PDF documents (F-07). Checked
 * here, not trusted from the page: the questions, endings and variables
 * it names exist on the form, a certificate has a rule, and extra
 * recipients are teammates who can see responses.
 */
export async function saveDocumentAction(
  formId: string,
  input: DocumentInput,
): Promise<Result> {
  const parsed = DocumentInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  }
  const ctx = await editable(formId);
  if (!ctx)
    return { ok: false, message: "You don't have permission to change this form." };
  const { kind, settings, recipients, memberIds, enabled } = parsed.data;
  const schema = ctx.schema;
  const questionIds = new Set(schema?.questions.map((q) => q.id) ?? []);
  for (const id of [settings.emailQuestionId, settings.nameQuestionId]) {
    if (id && !questionIds.has(id)) {
      return { ok: false, message: "A question it uses isn't on the form any more." };
    }
  }
  if (settings.endingIds?.some((id) => !schema?.endings.some((e) => e.id === id))) {
    return { ok: false, message: "An ending it uses isn't on the form any more." };
  }
  if (kind === "certificate" && enabled && !certificateHasRule(settings)) {
    return {
      ok: false,
      message: "Choose who earns the certificate: an ending, a minimum score, or both.",
    };
  }
  if (
    (recipients === "respondent" || recipients === "both") &&
    !settings.emailQuestionId
  ) {
    return { ok: false, message: "Choose the question with the respondent's email." };
  }
  const allowed = new Set(
    (await assignableMembers(ctx.supabase, ctx.workspace.id)).map((m) => m.id),
  );
  if (memberIds.some((id) => !allowed.has(id))) {
    return {
      ok: false,
      message: "Extra recipients must be teammates who can see responses.",
    };
  }

  const { error } = await ctx.supabase.from("form_documents").upsert(
    {
      form_id: formId,
      kind,
      enabled,
      settings: settings as unknown as Json,
      recipients,
      member_ids: memberIds,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "form_id,kind" },
  );
  if (error) return { ok: false, message: "Couldn't save. Please try again." };
  revalidatePath(`/forms/${formId}/integrations`);
  return { ok: true };
}

/** Removes a document. Numbers already issued go with it. */
export async function removeDocumentAction(
  formId: string,
  kind: string,
): Promise<Result> {
  if (!(DOCUMENT_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, message: "Unknown document." };
  }
  const ctx = await editable(formId);
  if (!ctx)
    return { ok: false, message: "You don't have permission to change this form." };
  const { error } = await ctx.supabase
    .from("form_documents")
    .delete()
    .eq("form_id", formId)
    .eq("kind", kind as (typeof DOCUMENT_KINDS)[number]);
  if (error) return { ok: false, message: "Couldn't remove it. Please try again." };
  revalidatePath(`/forms/${formId}/integrations`);
  return { ok: true };
}
