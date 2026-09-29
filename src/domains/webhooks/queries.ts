import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { AnswerMap } from "@/domains/logic";
import {
  buildWebhookPayload,
  serializeWebhookPayload,
  type WebhookPayload,
} from "./payload";
import { signatureHeaderValue } from "./signing";
import { nextBackoffDelayMs, isExhausted } from "./backoff";
import { isDisallowedWebhookHost, resolvesToDisallowedAddress } from "./url-safety";

type Client = SupabaseClient<Database>;

export type WebhookEndpoint = {
  id: string;
  formId: string;
  url: string;
  enabled: boolean;
  createdAt: string;
};

export async function listWebhookEndpoints(
  supabase: Client,
  formId: string,
): Promise<WebhookEndpoint[]> {
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .select("id, form_id, url, enabled, created_at")
    .eq("form_id", formId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    formId: row.form_id,
    url: row.url,
    enabled: row.enabled,
    createdAt: row.created_at,
  }));
}

function generateSigningSecret(): string {
  return `whsec_${crypto.randomUUID().replace(/-/g, "")}`;
}

export async function createWebhookEndpoint(
  supabase: Client,
  formId: string,
  url: string,
): Promise<{ id: string; signingSecret: string }> {
  const signingSecret = generateSigningSecret();
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .insert({ form_id: formId, url, signing_secret: signingSecret })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id, signingSecret };
}

export async function setWebhookEndpointEnabled(
  supabase: Client,
  id: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("webhook_endpoints")
    .update({ enabled })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteWebhookEndpoint(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from("webhook_endpoints").delete().eq("id", id);
  if (error) throw error;
}

export type DeliveryLogEntry = {
  id: string;
  eventType: string;
  status: "pending" | "succeeded" | "failed" | "exhausted";
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listDeliveries(
  supabase: Client,
  endpointId: string,
): Promise<DeliveryLogEntry[]> {
  const { data, error } = await supabase
    .from("webhook_deliveries")
    .select("id, event_type, status, attempt_count, last_error, created_at, updated_at")
    .eq("endpoint_id", endpointId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    status: row.status,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Called (via the admin client) right after a response completes.
 * Enqueues one `pending` delivery per enabled endpoint on the form —
 * enqueueing is separate from actually sending, so a slow/unreachable
 * consumer can never affect the respondent-facing response, and the
 * retry sweep has real rows to work from.
 */
export async function enqueueWebhookDeliveries(
  admin: Client,
  formId: string,
  responseId: string,
  endingId: string | null,
  answers: AnswerMap,
): Promise<string[]> {
  const { data: endpoints, error: endpointsError } = await admin
    .from("webhook_endpoints")
    .select("id")
    .eq("form_id", formId)
    .eq("enabled", true);
  if (endpointsError) throw endpointsError;
  if (!endpoints || endpoints.length === 0) return [];

  const submittedAt = new Date().toISOString();
  const rows = endpoints.map((endpoint) => {
    const payload = buildWebhookPayload({
      eventId: crypto.randomUUID(),
      formId,
      responseId,
      submittedAt,
      endingId,
      answers,
    });
    return {
      endpoint_id: endpoint.id,
      response_id: responseId,
      event_id: payload.eventId,
      event_type: payload.eventType,
      payload: payload as unknown as Json,
      status: "pending" as const,
    };
  });

  const { data: inserted, error: insertError } = await admin
    .from("webhook_deliveries")
    .insert(rows)
    .select("id");
  if (insertError) throw insertError;

  return (inserted ?? []).map((r) => r.id);
}

export type DeliveryAttemptResult = {
  status: "succeeded" | "failed" | "exhausted";
  error?: string;
};

async function attemptDelivery(
  url: string,
  signingSecret: string,
  payload: WebhookPayload,
): Promise<DeliveryAttemptResult> {
  // Defense in depth — the same host check already runs when a
  // creator adds the endpoint, but checking again immediately before
  // every actual outbound request costs nothing and protects against
  // a URL that was somehow stored before this check existed, or
  // edited directly.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { status: "failed", error: "invalid URL" };
  }
  if (
    isDisallowedWebhookHost(parsedUrl.hostname) ||
    (await resolvesToDisallowedAddress(parsedUrl.hostname))
  ) {
    return { status: "failed", error: "endpoint host not allowed" };
  }

  const body = serializeWebhookPayload(payload);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-FormCraft-Signature": signatureHeaderValue(signingSecret, body),
        "X-FormCraft-Event": payload.eventType,
      },
      body,
      signal: controller.signal,
      // Never follow redirects: a public URL could otherwise bounce the
      // request to an internal address (see url-safety.ts).
      redirect: "manual",
    });
    clearTimeout(timeout);

    if (res.ok) return { status: "succeeded" };
    if (res.status >= 300 && res.status < 400) {
      return {
        status: "failed",
        error: `HTTP ${res.status} redirect — webhooks don't follow redirects; use the final URL`,
      };
    }
    return { status: "failed", error: `HTTP ${res.status}` };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "network error",
    };
  }
}

const DISPATCH_BATCH_SIZE = 20;

/**
 * The retry sweep: processes due deliveries (status pending/failed
 * with next_attempt_at in the past), one HTTP attempt each, updating
 * status/attempt_count/next_attempt_at per the bounded backoff
 * schedule. Meant to be invoked by POST /api/cron/webhooks/dispatch on
 * an external schedule (see that route's docs) — there's no
 * long-running worker process in this deployment model.
 */
export async function dispatchDueDeliveries(
  admin: Client,
): Promise<{ processed: number }> {
  const { data: due, error } = await admin
    .from("webhook_deliveries")
    .select("id, endpoint_id, payload, attempt_count")
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .limit(DISPATCH_BATCH_SIZE);
  if (error) throw error;
  if (!due || due.length === 0) return { processed: 0 };

  for (const delivery of due) {
    const { data: endpoint } = await admin
      .from("webhook_endpoints")
      .select("url, signing_secret, enabled")
      .eq("id", delivery.endpoint_id)
      .maybeSingle();

    if (!endpoint || !endpoint.enabled) {
      await admin
        .from("webhook_deliveries")
        .update({ status: "failed", last_error: "endpoint disabled or deleted" })
        .eq("id", delivery.id);
      continue;
    }

    const attemptCount = delivery.attempt_count + 1;
    const result = await attemptDelivery(
      endpoint.url,
      endpoint.signing_secret,
      delivery.payload as unknown as WebhookPayload,
    );

    if (result.status === "succeeded") {
      await admin
        .from("webhook_deliveries")
        .update({ status: "succeeded", attempt_count: attemptCount, last_error: null })
        .eq("id", delivery.id);
      continue;
    }

    const delayMs = nextBackoffDelayMs(attemptCount);
    await admin
      .from("webhook_deliveries")
      .update({
        status: isExhausted(attemptCount) ? "exhausted" : "failed",
        attempt_count: attemptCount,
        last_error: result.error ?? "unknown error",
        next_attempt_at: new Date(Date.now() + (delayMs ?? 0)).toISOString(),
      })
      .eq("id", delivery.id);
  }

  return { processed: due.length };
}

/** Sends a synthetic test payload immediately (no enqueue/retry) so a
 * creator can verify their endpoint works. Not recorded in the
 * delivery log — it's a connectivity check, not a real event. */
export async function sendTestDelivery(
  supabase: Client,
  endpointId: string,
): Promise<DeliveryAttemptResult> {
  const { data: endpoint, error } = await supabase
    .from("webhook_endpoints")
    .select("url, signing_secret, form_id")
    .eq("id", endpointId)
    .single();
  if (error) throw error;

  const payload = buildWebhookPayload({
    eventId: crypto.randomUUID(),
    formId: endpoint.form_id,
    responseId: "test",
    submittedAt: new Date().toISOString(),
    endingId: null,
    answers: { example_question: "example answer" },
  });

  return attemptDelivery(endpoint.url, endpoint.signing_secret, payload);
}
