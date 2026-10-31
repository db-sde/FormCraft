import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * The per-response timeline (master spec F-31): everything that happened
 * to one response, in one ordered list — started, last saved, submitted,
 * emails, webhook (Slack, HubSpot, Zapier and plain webhooks), Google
 * Sheets and payment attempts, replays, and the team's record changes.
 *
 * Integration attempts keep living in their own tables (each row already
 * carries the response id, a status, an attempt count and the last
 * error); the timeline reads them alongside `response_events`, which
 * holds what no other table does. Payloads are never shown, only
 * outcomes and error messages.
 */

export type TimelineOutcome = "ok" | "failed" | "pending" | "skipped";

export type TimelineEntry = {
  /** Stable key for React and for tests. */
  key: string;
  at: string;
  title: string;
  outcome: TimelineOutcome;
  detail?: string;
  /** Who did it, for the team's own actions. */
  actor?: string | null;
  /** A failed integration attempt that may be sent again. */
  replay?: { target: "webhook" | "sheets"; id: string };
};

export type TimelineSources = {
  response: {
    startedAt: string;
    lastActiveAt: string;
    completedAt: string | null;
    status: string;
  };
  deliveries: {
    id: string;
    kind: string;
    status: string;
    attemptCount: number;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
  sheets: {
    id: string;
    status: string;
    attemptCount: number;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
  payment: {
    status: string;
    amount: number;
    currency: string;
    createdAt: string;
    paidAt: string | null;
  } | null;
  events: {
    id: number;
    kind: string;
    outcome: string;
    detail: Json;
    actor: string | null;
    createdAt: string;
  }[];
};

const INTEGRATION_LABEL: Record<string, string> = {
  webhook: "Webhook",
  slack: "Slack",
  hubspot: "HubSpot",
  zapier: "Zapier",
  make: "Make",
};

const DOCUMENT_LABEL: Record<string, string> = {
  summary: "Response summary",
  order: "Order confirmation",
  registration: "Registration confirmation",
  certificate: "Certificate",
};

const REVIEW_LABEL: Record<string, string> = {
  new: "New",
  in_progress: "In progress",
  done: "Done",
};

function jobOutcome(status: string): TimelineOutcome {
  if (status === "succeeded") return "ok";
  if (status === "pending") return "pending";
  return "failed";
}

function attempts(count: number) {
  return count === 1 ? "1 attempt" : `${count} attempts`;
}

function jobDetail(status: string, count: number, lastError: string | null) {
  if (status === "succeeded")
    return count > 1 ? `Sent after ${attempts(count)}` : undefined;
  if (status === "pending")
    return count > 0 ? `Retrying · ${attempts(count)} so far` : "Queued";
  const tail = status === "exhausted" ? "gave up" : "will retry";
  return [lastError, `${attempts(count)}, ${tail}`].filter(Boolean).join(" · ");
}

function record(detail: Json): Record<string, unknown> {
  return detail && typeof detail === "object" && !Array.isArray(detail)
    ? (detail as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function eventEntry(event: TimelineSources["events"][number]): TimelineEntry {
  const d = record(event.detail);
  const outcome: TimelineOutcome =
    event.outcome === "failed"
      ? "failed"
      : event.outcome === "skipped"
        ? "skipped"
        : "ok";
  const base = {
    key: `event-${event.id}`,
    at: event.createdAt,
    outcome,
    actor: event.actor,
  };
  switch (event.kind) {
    case "email_owner":
      return {
        ...base,
        title: "Notification email to the form owner",
        detail: str(d.reason),
      };
    case "email_respondent":
      return {
        ...base,
        title: "Confirmation email to the respondent",
        detail: str(d.reason),
      };
    case "replay":
      return {
        ...base,
        title: `Sent again: ${d.target === "sheets" ? "Google Sheets" : (INTEGRATION_LABEL[String(d.integration)] ?? "Webhook")}`,
      };
    case "status_changed":
      return {
        ...base,
        title: `Status set to ${REVIEW_LABEL[String(d.to)] ?? String(d.to)}`,
        detail: d.from
          ? `Was ${REVIEW_LABEL[String(d.from)] ?? String(d.from)}`
          : undefined,
      };
    case "assigned":
      return {
        ...base,
        title: d.to ? `Assigned to ${str(d.toName) ?? "a teammate"}` : "Unassigned",
      };
    case "document_emailed":
      return {
        ...base,
        title: `${DOCUMENT_LABEL[String(d.document)] ?? "Document"} PDF emailed`,
        detail: str(d.reason),
      };
    case "email_rule":
      return {
        ...base,
        title: `Notification “${str(d.rule) ?? "rule"}” emailed`,
        detail:
          str(d.reason) ??
          (typeof d.recipients === "number"
            ? `${d.recipients} recipient${d.recipients === 1 ? "" : "s"}`
            : undefined),
      };
    case "commented":
      return { ...base, title: "Comment added" };
    default:
      return { ...base, title: event.kind };
  }
}

function formatMoney(amount: number, currency: string) {
  const code = currency.toUpperCase();
  try {
    const digits =
      new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    return new Intl.NumberFormat("en", { style: "currency", currency: code }).format(
      amount / 10 ** digits,
    );
  } catch {
    return `${amount} ${code}`;
  }
}

/**
 * The ordered timeline. Oldest first; ties keep a fixed order (response
 * lifecycle, then emails and integrations, then the team's actions) so
 * the list never reshuffles between page loads.
 */
export function buildTimeline(sources: TimelineSources): TimelineEntry[] {
  const { response } = sources;
  const entries: (TimelineEntry & { rank: number })[] = [
    {
      key: "started",
      at: response.startedAt,
      title: "Started",
      outcome: "ok",
      rank: 0,
    },
  ];
  if (response.status === "completed" && response.completedAt) {
    entries.push({
      key: "completed",
      at: response.completedAt,
      title: "Submitted",
      outcome: "ok",
      rank: 1,
    });
  } else if (response.lastActiveAt !== response.startedAt) {
    entries.push({
      key: "saved",
      at: response.lastActiveAt,
      title: "Last saved",
      outcome: "pending",
      detail: "Not submitted yet",
      rank: 1,
    });
  }
  for (const d of sources.deliveries) {
    entries.push({
      key: `webhook-${d.id}`,
      at: d.createdAt,
      title: INTEGRATION_LABEL[d.kind] ?? "Webhook",
      outcome: jobOutcome(d.status),
      detail: jobDetail(d.status, d.attemptCount, d.lastError),
      replay:
        d.status === "failed" || d.status === "exhausted"
          ? { target: "webhook", id: d.id }
          : undefined,
      rank: 3,
    });
  }
  for (const s of sources.sheets) {
    entries.push({
      key: `sheets-${s.id}`,
      at: s.createdAt,
      title: "Google Sheets row",
      outcome: jobOutcome(s.status),
      detail: jobDetail(s.status, s.attemptCount, s.lastError),
      replay:
        s.status === "failed" || s.status === "exhausted"
          ? { target: "sheets", id: s.id }
          : undefined,
      rank: 3,
    });
  }
  if (sources.payment) {
    const p = sources.payment;
    const amount = formatMoney(p.amount, p.currency);
    entries.push({
      key: "payment",
      at: p.createdAt,
      title: `Payment of ${amount} started`,
      outcome: "ok",
      rank: 2,
    });
    if (p.status === "paid" && p.paidAt) {
      entries.push({ key: "paid", at: p.paidAt, title: "Paid", outcome: "ok", rank: 2 });
    } else if (p.status !== "pending") {
      entries.push({
        key: "payment-ended",
        at: p.createdAt,
        title: p.status === "expired" ? "Payment expired" : "Payment failed",
        outcome: "failed",
        rank: 2,
      });
    }
  }
  for (const e of sources.events) {
    entries.push({
      ...eventEntry(e),
      rank:
        e.kind.startsWith("email_") || e.kind === "document_emailed"
          ? 2
          : e.kind === "replay"
            ? 3
            : 4,
    });
  }
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        a.entry.at.localeCompare(b.entry.at) ||
        a.entry.rank - b.entry.rank ||
        a.index - b.index,
    )
    .map(({ entry }) => {
      const { rank: _rank, ...rest } = entry;
      void _rank;
      return rest;
    });
}

/** Reads a response's timeline as the signed-in user (RLS decides what
 * they may see). */
export async function getResponseTimeline(
  supabase: Client,
  response: TimelineSources["response"] & { id: string },
): Promise<TimelineEntry[]> {
  const [deliveries, sheets, payment, events] = await Promise.all([
    supabase
      .from("webhook_deliveries")
      .select(
        "id, status, attempt_count, last_error, created_at, updated_at, webhook_endpoints(kind)",
      )
      .eq("response_id", response.id)
      .order("created_at"),
    supabase
      .from("sheets_sync_log")
      .select("id, status, attempt_count, last_error, created_at, updated_at")
      .eq("response_id", response.id)
      .order("created_at"),
    supabase
      .from("payments")
      .select("status, amount, currency, created_at, paid_at")
      .eq("response_id", response.id)
      .maybeSingle(),
    supabase
      .from("response_events")
      .select("id, kind, outcome, detail, created_at, profiles(full_name, email)")
      .eq("response_id", response.id)
      .order("created_at"),
  ]);
  return buildTimeline({
    response,
    deliveries: (deliveries.data ?? []).map((d) => ({
      id: d.id,
      kind: (d.webhook_endpoints as { kind: string } | null)?.kind ?? "webhook",
      status: d.status,
      attemptCount: d.attempt_count,
      lastError: d.last_error,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    })),
    sheets: (sheets.data ?? []).map((s) => ({
      id: s.id,
      status: s.status,
      attemptCount: s.attempt_count,
      lastError: s.last_error,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    })),
    payment: payment.data
      ? {
          status: payment.data.status,
          amount: payment.data.amount,
          currency: payment.data.currency,
          createdAt: payment.data.created_at,
          paidAt: payment.data.paid_at,
        }
      : null,
    events: (events.data ?? []).map((e) => {
      const profile = e.profiles as { full_name: string | null; email: string } | null;
      return {
        id: e.id,
        kind: e.kind,
        outcome: e.outcome,
        detail: e.detail,
        actor: profile ? profile.full_name || profile.email : null,
        createdAt: e.created_at,
      };
    }),
  });
}

/** Records a timeline event. Service role; never throws (it runs beside
 * work that must not fail because of it). */
export async function logResponseEvent(
  admin: Client,
  event: {
    responseId: string;
    kind: Database["public"]["Tables"]["response_events"]["Insert"]["kind"];
    outcome?: "ok" | "failed" | "skipped";
    detail?: Record<string, string | number | boolean | null>;
    actorId?: string | null;
  },
): Promise<void> {
  try {
    await admin.from("response_events").insert({
      response_id: event.responseId,
      kind: event.kind,
      outcome: event.outcome ?? "ok",
      detail: (event.detail ?? {}) as Json,
      actor_id: event.actorId ?? null,
    });
  } catch {
    // The timeline is a record of what happened, not part of it.
  }
}

/** Email results worth a timeline entry: a send, a failure, or a reason
 * it couldn't go that the creator can fix. "Not turned on" isn't shown. */
export function emailEvent(
  result: { sent: true } | { sent: false; reason: string },
): { outcome: "ok" | "failed" | "skipped"; reason?: string } | null {
  if (result.sent) return { outcome: "ok" };
  switch (result.reason) {
    case "send_failed":
      return { outcome: "failed", reason: "The email service refused it" };
    case "no_api_key":
      return { outcome: "skipped", reason: "Email isn't set up on this server" };
    case "no_recipient":
      return { outcome: "skipped", reason: "No email address to send to" };
    case "no_owner_email":
      return { outcome: "skipped", reason: "The owner has no email address" };
    case "daily_cap":
      return { outcome: "skipped", reason: "Daily limit for this form reached" };
    default:
      return null;
  }
}
