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

/** The delivery's payload comes from what is *stored* for the response
 * (completion time, ending, the answers on the path taken) — never from
 * the request that completed it — so every route to a delivery (right
 * after submit, or the recovery sweep) sends the same thing. */
async function loadResponseForDelivery(admin: Client, responseId: string) {
  const { data: response, error } = await admin
    .from("responses")
    .select("form_id, status, spam_suspected, ending_id, completed_at")
    .eq("id", responseId)
    .maybeSingle();
  if (error) throw error;
  if (!response || response.status !== "completed" || response.spam_suspected)
    return null;

  const { data: answerRows, error: answersError } = await admin
    .from("answers")
    .select("question_id, value")
    .eq("response_id", responseId);
  if (answersError) throw answersError;

  return {
    formId: response.form_id,
    endingId: response.ending_id,
    submittedAt: response.completed_at ?? new Date().toISOString(),
    answers: Object.fromEntries(
      (answerRows ?? []).map((a) => [a.question_id, a.value]),
    ) as AnswerMap,
  };
}

/**
 * Enqueues one `pending` delivery per enabled endpoint on the form for a
 * completed response. Enqueueing is separate from sending, so a slow or
 * unreachable consumer can never affect the respondent. Idempotent
 * (one delivery per endpoint + response): calling it twice, or racing
 * the recovery sweep, never produces a duplicate. Spam-flagged and
 * unfinished responses get nothing.
 */
export async function enqueueWebhookDeliveries(
  admin: Client,
  responseId: string,
  onlyEndpointIds?: string[],
): Promise<number> {
  const response = await loadResponseForDelivery(admin, responseId);
  if (!response) return 0;

  let endpointsQuery = admin
    .from("webhook_endpoints")
    .select("id")
    .eq("form_id", response.formId)
    .eq("enabled", true);
  if (onlyEndpointIds) endpointsQuery = endpointsQuery.in("id", onlyEndpointIds);
  const { data: endpoints, error: endpointsError } = await endpointsQuery;
  if (endpointsError) throw endpointsError;
  if (!endpoints || endpoints.length === 0) return 0;

  const rows = endpoints.map((endpoint) => {
    const payload = buildWebhookPayload({
      eventId: crypto.randomUUID(),
      formId: response.formId,
      responseId,
      submittedAt: response.submittedAt,
      endingId: response.endingId,
      answers: response.answers,
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
    .upsert(rows, {
      onConflict: "endpoint_id,response_id,event_type",
      ignoreDuplicates: true,
    })
    .select("id");
  if (insertError) throw insertError;
  return inserted?.length ?? 0;
}

const RECOVERY_BATCH = 200;

/**
 * Creates the deliveries a completed response should have but doesn't —
 * because the work after the response was sent failed or the process was
 * killed. Run by the cron sweep before dispatching.
 */
export async function recoverMissingWebhookDeliveries(
  admin: Client,
): Promise<{ recovered: number }> {
  const { data, error } = await admin.rpc("responses_missing_webhook_delivery", {
    p_limit: RECOVERY_BATCH,
  });
  if (error) throw error;

  const byResponse = new Map<string, string[]>();
  for (const row of data ?? []) {
    byResponse.set(row.response_id, [
      ...(byResponse.get(row.response_id) ?? []),
      row.endpoint_id,
    ]);
  }
  let recovered = 0;
  for (const [responseId, endpointIds] of byResponse) {
    recovered += await enqueueWebhookDeliveries(admin, responseId, endpointIds);
  }
  return { recovered };
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
/** How long a claimed job is reserved for its worker; if the worker dies
 * mid-attempt the job becomes due again after this. Comfortably longer
 * than the 10-second request timeout. */
const CLAIM_LEASE_SECONDS = 120;

/**
 * The delivery sweep: claims due deliveries (so overlapping sweeps never
 * take the same row), makes one HTTP attempt each, and records the
 * outcome with the bounded backoff schedule. Each job is isolated — one
 * that throws (or whose destination is gone) is recorded and the rest
 * still run. Meant to be called by /api/cron/webhooks/dispatch; there's
 * no long-running worker in this deployment model.
 */
export async function dispatchDueDeliveries(
  admin: Client,
): Promise<{ processed: number }> {
  const { data: due, error } = await admin.rpc("claim_due_webhook_deliveries", {
    p_limit: DISPATCH_BATCH_SIZE,
    p_lease_seconds: CLAIM_LEASE_SECONDS,
  });
  if (error) throw error;
  if (!due || due.length === 0) return { processed: 0 };

  for (const delivery of due) {
    try {
      await processDelivery(admin, delivery);
    } catch (jobError) {
      await recordFailure(
        admin,
        delivery.id,
        delivery.attempt_count + 1,
        jobError instanceof Error ? jobError.message : "delivery failed",
      );
    }
  }

  return { processed: due.length };
}

async function recordFailure(
  admin: Client,
  deliveryId: string,
  attemptCount: number,
  message: string,
) {
  const delayMs = nextBackoffDelayMs(attemptCount);
  await admin
    .from("webhook_deliveries")
    .update({
      status: isExhausted(attemptCount) ? "exhausted" : "failed",
      attempt_count: attemptCount,
      last_error: message.slice(0, 500),
      next_attempt_at: new Date(Date.now() + (delayMs ?? 0)).toISOString(),
    })
    .eq("id", deliveryId);
}

async function processDelivery(
  admin: Client,
  delivery: { id: string; endpoint_id: string; payload: Json; attempt_count: number },
) {
  const { data: endpoint } = await admin
    .from("webhook_endpoints")
    .select("url, signing_secret, enabled")
    .eq("id", delivery.endpoint_id)
    .maybeSingle();

  if (!endpoint || !endpoint.enabled) {
    // Terminal, not "failed": a failed row stays due and would be picked
    // up by every sweep, crowding out deliveries that can succeed.
    await admin
      .from("webhook_deliveries")
      .update({ status: "exhausted", last_error: "endpoint disabled or deleted" })
      .eq("id", delivery.id);
    return;
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
    return;
  }
  await recordFailure(admin, delivery.id, attemptCount, result.error ?? "unknown error");
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
