"use server";

import { revalidatePath } from "next/cache";
import { getWorkspacePlan, type Feature } from "@/domains/billing";
import {
  deleteCredential,
  maskSecret,
  saveCredential,
  type Provider,
} from "@/domains/integrations/credentials";
import { isHubspotToken, verifyHubspotToken } from "@/domains/integrations/hubspot";
import { isStripeSecretKey, isStripeWebhookSecret } from "@/domains/payments";
import { canAdmin } from "@/domains/workspaces";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/domains/audit";

export type ConnectionResult =
  { ok: true; message?: string } | { ok: false; message: string };

async function adminWithFeature(feature: Feature) {
  const ctx = await getCurrentWorkspace();
  if (!canAdmin(ctx.workspace.role))
    return { error: "Only the owner and admins can connect accounts." };
  const { entitlements } = await getWorkspacePlan(createAdminClient(), ctx.workspace.id);
  if (!entitlements[feature]) return { error: "This is part of the Business plan." };
  return { ctx };
}

/** Stripe: the workspace's own secret key and webhook signing secret,
 * checked with Stripe before they're stored (encrypted). */
export async function connectStripeAction(
  secretKey: string,
  webhookSecret: string,
): Promise<ConnectionResult> {
  const key = secretKey.trim();
  const whsec = webhookSecret.trim();
  if (!isStripeSecretKey(key)) {
    return {
      ok: false,
      message:
        "Paste a Stripe secret key (sk_live_… or sk_test_…) or a restricted key (rk_…).",
    };
  }
  if (!isStripeWebhookSecret(whsec)) {
    return {
      ok: false,
      message:
        "Paste the webhook signing secret (whsec_…) from the endpoint you added in Stripe.",
    };
  }
  const allowed = await adminWithFeature("payments");
  if ("error" in allowed) return { ok: false, message: allowed.error ?? "Not allowed." };
  const base = process.env.STRIPE_API_BASE ?? "https://api.stripe.com";
  const check = await fetch(`${base}/v1/balance`, {
    headers: { Authorization: `Bearer ${key}` },
  }).catch(() => null);
  if (!check?.ok) return { ok: false, message: "Stripe didn't accept that key." };
  await saveCredential(
    createAdminClient(),
    allowed.ctx.workspace.id,
    "stripe",
    { secretKey: key, webhookSecret: whsec },
    `${maskSecret(key)}${key.includes("_test_") ? " (test mode)" : ""}`,
  );
  await audit(createAdminClient(), {
    workspaceId: allowed.ctx.workspace.id,
    actorId: allowed.ctx.user.id,
    action: "integration.connected",
    metadata: { provider: "stripe", mode: key.includes("_test_") ? "test" : "live" },
  });
  revalidatePath("/settings");
  return { ok: true, message: "Stripe connected." };
}

/** HubSpot: a private-app access token, checked with HubSpot first. */
export async function connectHubspotAction(token: string): Promise<ConnectionResult> {
  const value = token.trim();
  if (!isHubspotToken(value)) {
    return {
      ok: false,
      message: "Paste a HubSpot private app access token (it starts with pat-).",
    };
  }
  const allowed = await adminWithFeature("crm");
  if ("error" in allowed) return { ok: false, message: allowed.error ?? "Not allowed." };
  if (!(await verifyHubspotToken(value))) {
    return {
      ok: false,
      message: "HubSpot didn't accept that token. Check its contact scopes.",
    };
  }
  await saveCredential(
    createAdminClient(),
    allowed.ctx.workspace.id,
    "hubspot",
    { token: value },
    maskSecret(value),
  );
  await audit(createAdminClient(), {
    workspaceId: allowed.ctx.workspace.id,
    actorId: allowed.ctx.user.id,
    action: "integration.connected",
    metadata: { provider: "hubspot" },
  });
  revalidatePath("/settings");
  return { ok: true, message: "HubSpot connected." };
}

export async function disconnectAction(provider: Provider): Promise<ConnectionResult> {
  if (provider !== "stripe" && provider !== "hubspot")
    return { ok: false, message: "Unknown." };
  const ctx = await getCurrentWorkspace();
  if (!canAdmin(ctx.workspace.role))
    return { ok: false, message: "Only the owner and admins can do this." };
  await deleteCredential(createAdminClient(), ctx.workspace.id, provider);
  await audit(createAdminClient(), {
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    action: "integration.disconnected",
    metadata: { provider },
  });
  revalidatePath("/settings");
  return { ok: true, message: "Disconnected." };
}
