"use server";

import { revalidatePath } from "next/cache";
import {
  createWebhookEndpoint,
  setWebhookEndpointEnabled,
  deleteWebhookEndpoint,
  sendTestDelivery,
  isDisallowedWebhookHost,
  resolvesToDisallowedAddress,
} from "@/domains/webhooks";
import { setSpreadsheetId, setConnectionEnabled, disconnectForm } from "@/domains/sheets";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";

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

export async function disconnectSheetsAction(formId: string): Promise<void> {
  const { supabase } = await getCurrentWorkspace();
  await disconnectForm(supabase, formId);
  revalidatePath(`/forms/${formId}/integrations`);
}
