import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  createWebhookEndpoint,
  isDisallowedWebhookHost,
  resolvesToDisallowedAddress,
} from "@/domains/webhooks";
import { apiError, withApiKey } from "../shared";
import { audit } from "@/domains/audit";

const Body = z.object({
  formId: z.string().uuid(),
  url: z.string().url().max(2000),
  source: z.enum(["zapier", "make"]).default("zapier"),
});

/**
 * Subscribes to "new completed response" (Zapier / Make REST hooks).
 * The subscription is an ordinary signed webhook endpoint, so it gets
 * the same queue, retries and URL safety checks; it's removed when the
 * Zap is turned off (DELETE) or the key is revoked.
 */
export async function POST(request: NextRequest) {
  return withApiKey(request, "hooks:write", async (caller, admin) => {
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return apiError("invalid_body", "Send formId, url and source.", 400);
    const target = new URL(parsed.data.url);
    if (
      target.protocol !== "https:" ||
      isDisallowedWebhookHost(target.hostname) ||
      (await resolvesToDisallowedAddress(target.hostname))
    ) {
      return apiError("invalid_url", "The URL must be public and use HTTPS.", 400);
    }
    const { data: form } = await admin
      .from("forms")
      .select("id")
      .eq("id", parsed.data.formId)
      .eq("workspace_id", caller.workspaceId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!form) return apiError("not_found", "Form not found.", 404);
    const { id } = await createWebhookEndpoint(admin, form.id, parsed.data.url, {
      kind: parsed.data.source,
      apiKeyId: caller.keyId,
    });
    await audit(admin, {
      workspaceId: caller.workspaceId,
      actorId: null,
      action: "api.hook_created",
      target: { type: "webhook", id },
      metadata: { apiKeyId: caller.keyId, source: parsed.data.source, formId: form.id },
    });
    return NextResponse.json({ id }, { status: 201 });
  });
}
