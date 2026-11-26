import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { AnswerMap } from "@/domains/logic";
import type { WebhookEvent, WebhookPayload } from "./payload";
import { endpointEvents } from "./queries";
import { getWorkspacePlan } from "@/domains/billing/entitlements";

/** Unfinished-response events are a Starter-and-up feature (pricing doc). */
async function partialsAllowed(
  admin: SupabaseClient<Database>,
  formId: string,
): Promise<boolean> {
  const { data: form } = await admin
    .from("forms")
    .select("workspace_id")
    .eq("id", formId)
    .maybeSingle();
  if (!form) return false;
  return (await getWorkspacePlan(admin, form.workspace_id)).entitlements
    .partial_responses;
}

type Client = SupabaseClient<Database>;

/**
 * Partial-response webhooks (F-53). Unfinished responses can be sent as
 * three events, each only to endpoints that asked for it, and only for
 * forms that keep unfinished responses at all (the creator's privacy
 * switch):
 *
 * - response.partial_saved: answers saved before submitting. Coalesced:
 *   one event per response per 10-minute window, sent a minute after the
 *   first save in it with the latest answers (a burst of saves is one
 *   event, not one per keystroke).
 * - response.abandoned: no activity for the endpoint's idle time. Found
 *   by the minute-by-minute sweep, once per idle spell.
 * - response.resumed: activity again after an abandoned event.
 *
 * Every event has a stable id (the same on every retry), and the queue's
 * unique key makes enqueueing twice a no-op. All of it is a side effect:
 * nothing here can fail or slow down saving an answer.
 */

/** Only these kinds take unfinished-response events. */
const PARTIAL_KINDS = ["webhook", "n8n"] as const;
export const PARTIAL_WINDOW_MS = 10 * 60 * 1000;
/** A save waits this long before it's sent, so a burst coalesces. */
export const PARTIAL_DEBOUNCE_MS = 60 * 1000;

/** The same event always gets the same id. */
export function stableEventId(parts: string[]): string {
  const hex = createHash("sha256").update(parts.join("|")).digest("hex");
  // Formatted as a version-5-style UUID, so it fits where ids are UUIDs.
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join("-");
}

type UnfinishedResponse = {
  id: string;
  formId: string;
  status: "in_progress" | "partial" | "completed";
  lastQuestionId: string | null;
  lastActiveAt: string;
  answers: AnswerMap;
  hidden: Record<string, string>;
};

async function loadUnfinished(
  admin: Client,
  responseId: string,
): Promise<UnfinishedResponse | null> {
  const { data: r } = await admin
    .from("responses")
    .select(
      "id, form_id, status, last_question_id, last_active_at, hidden_fields, spam_suspected, is_preview, forms!inner(save_partial_responses, archived_at)",
    )
    .eq("id", responseId)
    .maybeSingle();
  if (
    !r ||
    r.status === "completed" ||
    r.spam_suspected ||
    r.is_preview ||
    !(r.forms as { save_partial_responses: boolean }).save_partial_responses ||
    // Nothing is sent for an archived form (developer spec item 4).
    (r.forms as { archived_at: string | null }).archived_at !== null
  ) {
    return null;
  }
  const { data: rows } = await admin
    .from("answers")
    .select("question_id, value")
    .eq("response_id", responseId);
  return {
    id: r.id,
    formId: r.form_id,
    status: r.status,
    lastQuestionId: r.last_question_id,
    lastActiveAt: r.last_active_at,
    answers: Object.fromEntries((rows ?? []).map((a) => [a.question_id, a.value])),
    hidden: Object.fromEntries(
      Object.entries((r.hidden_fields ?? {}) as Record<string, unknown>).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    ),
  };
}

function payloadFor(
  response: UnfinishedResponse,
  eventType: WebhookEvent,
  eventId: string,
  occurredAt: string,
): WebhookPayload {
  return {
    eventId,
    eventType,
    formId: response.formId,
    responseId: response.id,
    submittedAt: null,
    occurredAt,
    status: response.status,
    lastQuestionId: response.lastQuestionId,
    endingId: null,
    answers: response.answers,
    variables: {},
    hidden: response.hidden,
  };
}

async function endpointsWanting(admin: Client, formId: string, events: WebhookEvent[]) {
  const { data } = await admin
    .from("webhook_endpoints")
    .select("id, config, created_at")
    .eq("form_id", formId)
    .eq("enabled", true)
    .in("kind", [...PARTIAL_KINDS]);
  return (data ?? []).map((e) => ({
    id: e.id,
    createdAt: e.created_at,
    wants: new Set(endpointEvents(e.config).filter((x) => events.includes(x))),
  }));
}

/**
 * After answers are saved: a resumed event where an abandoned one was
 * sent, and the window's partial-saved event (created, or brought up to
 * date while it's still waiting). Never throws.
 */
export async function enqueuePartialSaveEvents(
  admin: Client,
  responseId: string,
  now: Date = new Date(),
): Promise<number> {
  try {
    const response = await loadUnfinished(admin, responseId);
    if (!response || response.status !== "partial") return 0;
    if (!(await partialsAllowed(admin, response.formId))) return 0;
    const endpoints = (
      await endpointsWanting(admin, response.formId, [
        "response.partial_saved",
        "response.resumed",
      ])
    ).filter((e) => e.wants.size > 0);
    let queued = 0;
    for (const endpoint of endpoints) {
      if (endpoint.wants.has("response.resumed")) {
        const { data: abandoned } = await admin
          .from("webhook_deliveries")
          .select("dedupe_key")
          .eq("endpoint_id", endpoint.id)
          .eq("response_id", responseId)
          .eq("event_type", "response.abandoned")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (abandoned) {
          const key = `r:${abandoned.dedupe_key.slice(2)}`;
          const eventId = stableEventId([endpoint.id, responseId, "resumed", key]);
          const { data } = await admin
            .from("webhook_deliveries")
            .upsert(
              {
                endpoint_id: endpoint.id,
                response_id: responseId,
                event_id: eventId,
                event_type: "response.resumed",
                dedupe_key: key,
                payload: payloadFor(
                  response,
                  "response.resumed",
                  eventId,
                  now.toISOString(),
                ) as unknown as Json,
                status: "pending" as const,
              },
              {
                onConflict: "endpoint_id,response_id,event_type,dedupe_key",
                ignoreDuplicates: true,
              },
            )
            .select("id");
          queued += data?.length ?? 0;
        }
      }
      if (endpoint.wants.has("response.partial_saved")) {
        const key = `w:${Math.floor(now.getTime() / PARTIAL_WINDOW_MS)}`;
        const eventId = stableEventId([endpoint.id, responseId, "partial_saved", key]);
        const payload = payloadFor(
          response,
          "response.partial_saved",
          eventId,
          now.toISOString(),
        ) as unknown as Json;
        const { data } = await admin
          .from("webhook_deliveries")
          .upsert(
            {
              endpoint_id: endpoint.id,
              response_id: responseId,
              event_id: eventId,
              event_type: "response.partial_saved",
              dedupe_key: key,
              payload,
              status: "pending" as const,
              next_attempt_at: new Date(
                now.getTime() + PARTIAL_DEBOUNCE_MS,
              ).toISOString(),
            },
            {
              onConflict: "endpoint_id,response_id,event_type,dedupe_key",
              ignoreDuplicates: true,
            },
          )
          .select("id");
        if ((data?.length ?? 0) > 0) {
          queued += 1;
        } else {
          // Already waiting in this window: send the latest answers. Once
          // it's been sent, the next window's event carries them.
          await admin
            .from("webhook_deliveries")
            .update({ payload })
            .eq("endpoint_id", endpoint.id)
            .eq("response_id", responseId)
            .eq("event_type", "response.partial_saved")
            .eq("dedupe_key", key)
            .eq("status", "pending")
            .eq("attempt_count", 0);
        }
      }
    }
    return queued;
  } catch {
    return 0;
  }
}

const ABANDON_BATCH = 100;

/**
 * The sweep's half: an abandoned event for each unfinished response that
 * has been idle longer than its endpoint's idle time, once per idle spell
 * (the key is the time of the last activity). Run before dispatching.
 */
export async function enqueueAbandonedEvents(
  admin: Client,
  now: Date = new Date(),
): Promise<{ queued: number }> {
  const { data: due, error } = await admin.rpc("responses_due_abandoned_event", {
    p_limit: ABANDON_BATCH,
  });
  if (error) throw error;
  let queued = 0;
  for (const row of due ?? []) {
    const response = await loadUnfinished(admin, row.response_id);
    if (!response) continue;
    if (!(await partialsAllowed(admin, response.formId))) continue;
    const key = `a:${Math.floor(Date.parse(row.last_active_at) / 1000)}`;
    const eventId = stableEventId([row.endpoint_id, row.response_id, "abandoned", key]);
    const { data } = await admin
      .from("webhook_deliveries")
      .upsert(
        {
          endpoint_id: row.endpoint_id,
          response_id: row.response_id,
          event_id: eventId,
          event_type: "response.abandoned",
          dedupe_key: key,
          payload: payloadFor(
            response,
            "response.abandoned",
            eventId,
            now.toISOString(),
          ) as unknown as Json,
          status: "pending" as const,
        },
        {
          onConflict: "endpoint_id,response_id,event_type,dedupe_key",
          ignoreDuplicates: true,
        },
      )
      .select("id");
    queued += data?.length ?? 0;
  }
  return { queued };
}
