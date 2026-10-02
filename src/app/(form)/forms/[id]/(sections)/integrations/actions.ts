"use server";

import { revalidatePath } from "next/cache";
import {
  createWebhookEndpoint,
  setWebhookEndpointEnabled,
  deleteWebhookEndpoint,
  sendTestDelivery,
  isDisallowedWebhookHost,
  resolvesToDisallowedAddress,
  isSlackWebhookUrl,
} from "@/domains/webhooks";
import { z } from "zod";
import { EntitlementError, requireFeature, type Feature } from "@/domains/billing";
import { canEdit } from "@/domains/workspaces";
import { PaymentConfig } from "@/domains/payments/stripe";
import { mappingProblems, verifyHubspotToken } from "@/domains/integrations/hubspot";
import { loadCredential } from "@/domains/integrations/credentials";
import { parseFormSchema } from "@/domains/forms/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ConfirmationSettings,
  saveConfirmationSettings,
} from "@/domains/notifications/confirmation";
import { setSpreadsheetId, setConnectionEnabled, disconnectForm } from "@/domains/sheets";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { trackEvent } from "@/lib/analytics/track";

const MAX_URL_LENGTH = 2000;

export type CreateWebhookResult =
  | { ok: true; id: string; url: string; signingSecret: string; createdAt: string }
  | { ok: false; message: string };

export async function createWebhookEndpointAction(
  formId: string,
  url: string,
): Promise<CreateWebhookResult> {
  if (!url || url.length > MAX_URL_LENGTH) {
    return { ok: false, message: "Enter a URL." };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, message: "Enter a valid URL." };
  }
  const localDevHttp =
    process.env.NODE_ENV !== "production" &&
    parsed.protocol === "http:" &&
    parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !localDevHttp) {
    return { ok: false, message: "Webhook URLs must use HTTPS." };
  }
  if (
    isDisallowedWebhookHost(parsed.hostname) ||
    (await resolvesToDisallowedAddress(parsed.hostname))
  ) {
    return {
      ok: false,
      message: "Webhook URLs must point to a public address, not a private network.",
    };
  }

  const { supabase } = await getCurrentWorkspace();
  try {
    const result = await createWebhookEndpoint(supabase, formId, url);
    revalidatePath(`/forms/${formId}/integrations`);
    trackEvent({
      formId,
      eventType: "integration_connected",
      metadata: { provider: "webhook" },
    });
    return {
      ok: true,
      id: result.id,
      url,
      signingSecret: result.signingSecret,
      createdAt: new Date().toISOString(),
    };
  } catch {
    return { ok: false, message: "Failed to add webhook. Please try again." };
  }
}

export async function setWebhookEnabledAction(
  formId: string,
  endpointId: string,
  enabled: boolean,
): Promise<void> {
  const { supabase } = await getCurrentWorkspace();
  await setWebhookEndpointEnabled(supabase, endpointId, enabled);
  revalidatePath(`/forms/${formId}/integrations`);
}

export async function deleteWebhookEndpointAction(
  formId: string,
  endpointId: string,
): Promise<void> {
  const { supabase } = await getCurrentWorkspace();
  await deleteWebhookEndpoint(supabase, endpointId);
  revalidatePath(`/forms/${formId}/integrations`);
}

export async function sendTestDeliveryAction(
  endpointId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await getCurrentWorkspace();
  const result = await sendTestDelivery(supabase, endpointId);
  return { ok: result.status === "succeeded", error: result.error };
}

const SPREADSHEET_ID_PATTERN = /^[a-zA-Z0-9_-]{20,80}$/;

export async function setSpreadsheetIdAction(
  formId: string,
  spreadsheetId: string,
): Promise<{ ok: boolean; message?: string }> {
  const trimmed = spreadsheetId.trim();
  if (!SPREADSHEET_ID_PATTERN.test(trimmed)) {
    return {
      ok: false,
      message:
        "That doesn't look like a spreadsheet ID — copy the long id from the sheet's URL, between /d/ and /edit.",
    };
  }
  const { supabase } = await getCurrentWorkspace();
  await setSpreadsheetId(supabase, formId, trimmed);
  revalidatePath(`/forms/${formId}/integrations`);
  return { ok: true };
}

export async function setSheetsEnabledAction(
  formId: string,
  enabled: boolean,
): Promise<void> {
  const { supabase } = await getCurrentWorkspace();
  await setConnectionEnabled(supabase, formId, enabled);
  revalidatePath(`/forms/${formId}/integrations`);
}

export async function disconnectSheetsAction(formId: string): Promise<{ ok: boolean }> {
  const { supabase } = await getCurrentWorkspace();
  try {
    await disconnectForm(supabase, formId);
  } catch {
    return { ok: false };
  }
  revalidatePath(`/forms/${formId}/integrations`);
  return { ok: true };
}

export type FeatureResult = { ok: true } | { ok: false; message: string };

/** The form, in a workspace the caller can edit, whose plan includes
 * `feature` — or why not. */
async function editableFormWithFeature(formId: string, feature: Feature) {
  const { supabase, workspace } = await getCurrentWorkspace();
  if (!canEdit(workspace.role)) return { error: "You have view-only access." } as const;
  const { data: form } = await supabase
    .from("forms")
    .select("id")
    .eq("id", formId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!form) return { error: "Form not found." } as const;
  try {
    await requireFeature(supabase, workspace.id, feature);
  } catch (error) {
    if (error instanceof EntitlementError) return { error: error.message } as const;
    throw error;
  }
  return { supabase, workspace } as const;
}

const QuestionIds = z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(10);

/** Slack (P2.14): a Slack incoming-webhook URL plus the questions to show. */
export async function createSlackAction(
  formId: string,
  url: string,
  questionIds: string[],
): Promise<FeatureResult> {
  const trimmed = url.trim();
  if (!isSlackWebhookUrl(trimmed)) {
    return {
      ok: false,
      message:
        "Paste a Slack incoming-webhook URL (it starts with https://hooks.slack.com/services/).",
    };
  }
  const ids = QuestionIds.safeParse(questionIds);
  if (!ids.success) return { ok: false, message: "Choose up to ten questions." };
  const ctx = await editableFormWithFeature(formId, "slack");
  if ("error" in ctx) return { ok: false, message: ctx.error ?? "Not allowed." };
  try {
    await createWebhookEndpoint(ctx.supabase, formId, trimmed, {
      kind: "slack",
      config: { questionIds: ids.data },
    });
    revalidatePath(`/forms/${formId}/integrations`);
    trackEvent({
      formId,
      eventType: "integration_connected",
      metadata: { provider: "slack" },
    });
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't connect Slack. Please try again." };
  }
}

export async function setSlackQuestionsAction(
  formId: string,
  endpointId: string,
  questionIds: string[],
): Promise<FeatureResult> {
  const ids = QuestionIds.safeParse(questionIds);
  if (!ids.success) return { ok: false, message: "Choose up to ten questions." };
  const ctx = await editableFormWithFeature(formId, "slack");
  if ("error" in ctx) return { ok: false, message: ctx.error ?? "Not allowed." };
  const { error } = await ctx.supabase
    .from("webhook_endpoints")
    .update({ config: { questionIds: ids.data } })
    .eq("id", endpointId)
    .eq("form_id", formId)
    .eq("kind", "slack");
  if (error) return { ok: false, message: "Couldn't save that." };
  revalidatePath(`/forms/${formId}/integrations`);
  return { ok: true };
}

/** Confirmation emails to respondents (P2.18). */
export async function saveConfirmationAction(
  formId: string,
  settings: ConfirmationSettings,
): Promise<FeatureResult> {
  const parsed = ConfirmationSettings.safeParse({
    ...settings,
    ctaLabel: settings.ctaLabel?.trim() || null,
    ctaUrl: settings.ctaUrl?.trim() || null,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  }
  if (parsed.data.enabled && !parsed.data.recipientQuestionId) {
    return { ok: false, message: "Choose the question with the respondent's email." };
  }
  if (!parsed.data.enabled) {
    // Switching it off is always allowed, plan or not.
    const { supabase, workspace } = await getCurrentWorkspace();
    if (!canEdit(workspace.role))
      return { ok: false, message: "You have view-only access." };
    await saveConfirmationSettings(supabase, formId, parsed.data);
    revalidatePath(`/forms/${formId}/integrations`);
    return { ok: true };
  }
  const ctx = await editableFormWithFeature(formId, "confirmation_emails");
  if ("error" in ctx) return { ok: false, message: ctx.error ?? "Not allowed." };
  try {
    await saveConfirmationSettings(ctx.supabase, formId, parsed.data);
    revalidatePath(`/forms/${formId}/integrations`);
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't save. Please try again." };
  }
}

const TrackingInput = z.object({
  gaMeasurementId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^G-[A-Z0-9]{4,12}$/, "A Google Analytics ID looks like G-XXXXXXX.")
    .or(z.literal("")),
  gtmContainerId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^GTM-[A-Z0-9]{4,10}$/, "A Tag Manager ID looks like GTM-XXXXXX.")
    .or(z.literal("")),
  metaPixelId: z
    .string()
    .trim()
    .regex(/^[0-9]{6,20}$/, "A Meta Pixel ID is a number.")
    .or(z.literal("")),
});

/** Analytics and ad pixels (P2.12): identifiers only, never code. */
export async function saveTrackingAction(
  formId: string,
  input: z.input<typeof TrackingInput>,
): Promise<FeatureResult> {
  const parsed = TrackingInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the IDs." };
  }
  const clearing =
    !parsed.data.gaMeasurementId &&
    !parsed.data.gtmContainerId &&
    !parsed.data.metaPixelId;
  const ctx = clearing
    ? await (async () => {
        const c = await getCurrentWorkspace();
        return canEdit(c.workspace.role) ? c : { error: "You have view-only access." };
      })()
    : await editableFormWithFeature(formId, "tracking_pixels");
  if ("error" in ctx) return { ok: false, message: ctx.error ?? "Not allowed." };
  const { data, error } = await ctx.supabase
    .from("forms")
    .update({
      ga_measurement_id: parsed.data.gaMeasurementId || null,
      gtm_container_id: parsed.data.gtmContainerId || null,
      meta_pixel_id: parsed.data.metaPixelId || null,
    })
    .eq("id", formId)
    .eq("workspace_id", ctx.workspace.id)
    .select("id");
  if (error || !data?.length)
    return { ok: false, message: "Couldn't save. Please try again." };
  revalidatePath(`/forms/${formId}/integrations`);
  return { ok: true };
}

/** Payment on submit (P2.17): a fixed price or a calculated variable.
 * Null removes it. */
export async function savePaymentConfigAction(
  formId: string,
  config: PaymentConfig | null,
): Promise<FeatureResult> {
  if (config !== null && !PaymentConfig.safeParse(config).success) {
    return {
      ok: false,
      message:
        PaymentConfig.safeParse(config).error?.issues[0]?.message ??
        "Check the payment settings.",
    };
  }
  const ctx = config
    ? await editableFormWithFeature(formId, "payments")
    : await (async () => {
        const c = await getCurrentWorkspace();
        return canEdit(c.workspace.role) ? c : { error: "You have view-only access." };
      })();
  if ("error" in ctx) return { ok: false, message: ctx.error ?? "Not allowed." };
  const { data, error } = await ctx.supabase
    .from("forms")
    .update({ payment_config: config })
    .eq("id", formId)
    .eq("workspace_id", ctx.workspace.id)
    .select("id");
  if (error || !data?.length)
    return { ok: false, message: "Couldn't save. Please try again." };
  revalidatePath(`/forms/${formId}/integrations`);
  return { ok: true };
}

const HubspotMappingInput = z
  .record(
    z.string().regex(/^[a-z][a-z0-9_]{0,99}$/),
    z.string().regex(/^[A-Za-z0-9_-]{1,64}(\.[a-z]+)?$/),
  )
  .refine((m) => Object.keys(m).length <= 50, "Map up to 50 properties.");

/** HubSpot contact sync for this form (P2.15): the field mapping.
 * Null turns it off. */
export async function saveHubspotSyncAction(
  formId: string,
  mapping: Record<string, string> | null,
): Promise<FeatureResult> {
  const ctx = await editableFormWithFeature(formId, "crm");
  if ("error" in ctx) return { ok: false, message: ctx.error ?? "Not allowed." };
  const { data: existing } = await ctx.supabase
    .from("webhook_endpoints")
    .select("id")
    .eq("form_id", formId)
    .eq("kind", "hubspot")
    .maybeSingle();
  if (mapping === null) {
    if (existing)
      await ctx.supabase.from("webhook_endpoints").delete().eq("id", existing.id);
    revalidatePath(`/forms/${formId}/integrations`);
    return { ok: true };
  }
  const parsed = HubspotMappingInput.safeParse(mapping);
  if (!parsed.success) return { ok: false, message: "Check the property names." };
  if (!parsed.data.email) {
    return {
      ok: false,
      message: "Map a question to Email — contacts are matched by email.",
    };
  }
  if (existing) {
    await ctx.supabase
      .from("webhook_endpoints")
      .update({ config: { mapping: parsed.data } })
      .eq("id", existing.id);
  } else {
    await createWebhookEndpoint(ctx.supabase, formId, "https://api.hubapi.com", {
      kind: "hubspot",
      config: { mapping: parsed.data },
    });
  }
  revalidatePath(`/forms/${formId}/integrations`);
  return { ok: true };
}

/** "Test mapping": the mapping fits the form and the token still works
 * (without creating a contact). */
export async function testHubspotAction(
  formId: string,
  mapping: Record<string, string>,
): Promise<FeatureResult> {
  const ctx = await editableFormWithFeature(formId, "crm");
  if ("error" in ctx) return { ok: false, message: ctx.error ?? "Not allowed." };
  const { data: draft } = await ctx.supabase
    .from("form_versions")
    .select("schema")
    .eq("form_id", formId)
    .eq("status", "draft")
    .single();
  const problems = mappingProblems(parseFormSchema(draft!.schema), mapping);
  if (problems.length) return { ok: false, message: problems[0] };
  const credential = await loadCredential<{ token: string }>(
    createAdminClient(),
    ctx.workspace.id,
    "hubspot",
  );
  if (!credential)
    return { ok: false, message: "Connect HubSpot in Settings → Connections first." };
  if (!(await verifyHubspotToken(credential.token))) {
    return {
      ok: false,
      message: "HubSpot rejected the token. Reconnect it in Settings → Connections.",
    };
  }
  return { ok: true };
}
