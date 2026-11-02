import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { decryptJson, encryptJson, type EncryptedPayload } from "@/domains/sheets/crypto";
import { isExhausted, nextBackoffDelayMs } from "@/domains/webhooks/backoff";
import { refreshIfNeeded, TokenError, type Tokens } from "./oauth";
import { isReplayable } from "./catalog";

type Client = SupabaseClient<Database>;
type JobRow = Database["public"]["Tables"]["connector_jobs"]["Row"];

/**
 * The shared connector framework (master spec §5.3). Every connector —
 * Google Calendar here, Airtable, Salesforce, Notion, Mailchimp, Zoho
 * and Pipedrive in Phase 6 — is a set of actions run by one worker:
 *
 * - A job is queued once per idempotency key ("gcal:create:<booking>",
 *   "airtable:record:<response>"), so retries, recovery sweeps and manual
 *   replays never create a second one.
 * - The worker claims due jobs (skip locked, leased), refreshes the
 *   connection's tokens when needed, runs the action, and records the
 *   outcome: succeeded (with what the provider returned), failed (to
 *   retry with backoff) or exhausted (stops; shown with its error). An
 *   auth failure marks the connection invalid and stops its jobs.
 * - Actions must be safe to run again after a timeout: they use the
 *   provider's own idempotency (a deterministic id, an upsert on a
 *   dedupe field) — never "create" blindly twice.
 */

export type Connection = {
  id: string;
  workspaceId: string;
  userId: string | null;
  provider: string;
  label: string | null;
  settings: Record<string, unknown>;
  status: "ok" | "invalid" | "revoked";
  tokens: Tokens;
};

export type ActionResult =
  | {
      ok: true;
      result?: Record<string, unknown>;
      /** Nothing to do, on purpose (no consent, nothing mapped): shown
       * as skipped with this reason. */
      skipped?: string;
    }
  | { ok: false; retry: boolean; error: string; auth?: boolean };

export type ActionContext = {
  admin: Client;
  connection: Connection;
  fetch: typeof fetch;
};

export type ConnectorAction = (job: JobRow, ctx: ActionContext) => Promise<ActionResult>;

const ACTIONS = new Map<string, ConnectorAction>();

/** Connectors register their actions as `${provider}:${action}`. */
export function registerAction(provider: string, action: string, run: ConnectorAction) {
  ACTIONS.set(`${provider}:${action}`, run);
}

// --- connections -------------------------------------------------------------

function toConnection(
  row: Database["public"]["Tables"]["connector_connections"]["Row"],
): Connection {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    provider: row.provider,
    label: row.label,
    settings: (row.settings ?? {}) as Record<string, unknown>,
    status: row.status,
    tokens: decryptJson<Tokens>(row.encrypted as unknown as EncryptedPayload),
  };
}

export async function saveConnection(
  admin: Client,
  input: {
    workspaceId: string;
    userId: string | null;
    provider: string;
    tokens: Tokens;
    label: string | null;
    settings?: Record<string, unknown>;
    createdBy: string;
  },
): Promise<string> {
  // One per workspace (or per member, for personal ones): replace.
  let existing = admin
    .from("connector_connections")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("provider", input.provider);
  existing = input.userId
    ? existing.eq("user_id", input.userId)
    : existing.is("user_id", null);
  const { data: found } = await existing.maybeSingle();
  const row = {
    workspace_id: input.workspaceId,
    user_id: input.userId,
    provider: input.provider,
    encrypted: encryptJson(input.tokens) as unknown as Json,
    label: input.label?.slice(0, 200) ?? null,
    status: "ok" as const,
    created_by: input.createdBy,
    updated_at: new Date().toISOString(),
    ...(input.settings ? { settings: input.settings as Json } : {}),
  };
  const { data, error } = found
    ? await admin
        .from("connector_connections")
        .update(row)
        .eq("id", found.id)
        .select("id")
        .single()
    : await admin.from("connector_connections").insert(row).select("id").single();
  if (error || !data) throw error ?? new Error("connection not saved");
  return data.id;
}

export async function getConnection(
  admin: Client,
  id: string,
): Promise<Connection | null> {
  const { data } = await admin
    .from("connector_connections")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ? toConnection(data) : null;
}

export async function findConnection(
  admin: Client,
  workspaceId: string,
  provider: string,
  userId: string | null = null,
): Promise<Connection | null> {
  let q = admin
    .from("connector_connections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider);
  q = userId ? q.eq("user_id", userId) : q.is("user_id", null);
  const { data } = await q.maybeSingle();
  return data ? toConnection(data) : null;
}

export async function updateConnectionSettings(
  admin: Client,
  id: string,
  settings: Record<string, unknown>,
) {
  await admin
    .from("connector_connections")
    .update({ settings: settings as Json, updated_at: new Date().toISOString() })
    .eq("id", id);
}

/** Tokens fit to use now: refreshed and stored when they were expiring.
 * A refresh the provider refuses marks the connection invalid. */
export async function usableTokens(
  admin: Client,
  connection: Connection,
  fetcher: typeof fetch = fetch,
  options: { force?: boolean } = {},
): Promise<Tokens> {
  try {
    const { tokens, refreshed } = await refreshIfNeeded(
      connection.provider,
      // Forced: some providers (Salesforce) don't say when tokens expire,
      // so a refusal is the first sign.
      options.force ? { ...connection.tokens, expiresAt: 0 } : connection.tokens,
      fetcher,
    );
    if (refreshed) {
      await admin
        .from("connector_connections")
        .update({
          encrypted: encryptJson(tokens) as unknown as Json,
          updated_at: new Date().toISOString(),
        })
        .eq("id", connection.id);
      connection.tokens = tokens;
    }
    return tokens;
  } catch (error) {
    if (error instanceof TokenError) {
      await markConnection(admin, connection.id, "invalid");
    }
    throw error;
  }
}

export async function markConnection(
  admin: Client,
  id: string,
  status: "invalid" | "revoked",
) {
  await admin
    .from("connector_connections")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
}

/** Disconnects: no further jobs run for it (theirs are skipped). */
export async function revokeConnection(admin: Client, id: string) {
  // The tokens are discarded, not just unused.
  await admin
    .from("connector_connections")
    .update({
      status: "revoked",
      encrypted: encryptJson({ accessToken: "" }) as unknown as Json,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  await admin
    .from("connector_jobs")
    .update({
      status: "skipped",
      last_error: "Disconnected",
      updated_at: new Date().toISOString(),
    })
    .eq("connection_id", id)
    .in("status", ["pending", "failed"]);
}

// --- jobs --------------------------------------------------------------------

export async function enqueueJob(
  admin: Client,
  job: {
    connectionId: string | null;
    workspaceId: string;
    provider: string;
    action: string;
    idempotencyKey: string;
    responseId?: string | null;
    bookingId?: string | null;
    payload?: Record<string, unknown>;
    /** Recorded as skipped with this reason instead of queued (a
     * condition that didn't match), so the timeline says why. */
    skipped?: string;
  },
): Promise<void> {
  await admin.from("connector_jobs").upsert(
    {
      connection_id: job.connectionId,
      workspace_id: job.workspaceId,
      provider: job.provider,
      action: job.action,
      idempotency_key: job.idempotencyKey.slice(0, 300),
      response_id: job.responseId ?? null,
      booking_id: job.bookingId ?? null,
      payload: (job.payload ?? {}) as Json,
      ...(job.skipped ? { status: "skipped" as const, last_error: job.skipped } : {}),
    },
    { onConflict: "idempotency_key", ignoreDuplicates: true },
  );
}

const BATCH = 25;
const LEASE_SECONDS = 120;

/** Runs due jobs. Never throws; each job's outcome is recorded on it. */
export async function dispatchConnectorJobs(
  admin: Client,
  options: { fetch?: typeof fetch; limit?: number } = {},
): Promise<{ processed: number }> {
  const fetcher = options.fetch ?? fetch;
  const { data: jobs } = await admin.rpc("claim_connector_jobs", {
    p_limit: options.limit ?? BATCH,
    p_lease_seconds: LEASE_SECONDS,
  });
  for (const job of jobs ?? []) {
    await runJob(admin, job, fetcher);
  }
  return { processed: jobs?.length ?? 0 };
}

async function finish(admin: Client, job: JobRow, outcome: ActionResult) {
  const now = new Date().toISOString();
  if (outcome.ok && outcome.skipped) {
    await admin
      .from("connector_jobs")
      .update({
        status: "skipped",
        last_error: outcome.skipped.slice(0, 500),
        result: (outcome.result ?? null) as Json,
        updated_at: now,
      })
      .eq("id", job.id);
    return;
  }
  if (outcome.ok) {
    await admin
      .from("connector_jobs")
      .update({
        status: "succeeded",
        last_error: null,
        result: (outcome.result ?? null) as Json,
        updated_at: now,
      })
      .eq("id", job.id);
    return;
  }
  const delay = outcome.retry ? nextBackoffDelayMs(job.attempt_count) : null;
  await admin
    .from("connector_jobs")
    .update({
      status: delay === null || isExhausted(job.attempt_count) ? "exhausted" : "failed",
      last_error: outcome.error.slice(0, 500),
      next_attempt_at: new Date(Date.now() + (delay ?? 0)).toISOString(),
      updated_at: now,
    })
    .eq("id", job.id);
}

export async function runJob(admin: Client, job: JobRow, fetcher: typeof fetch = fetch) {
  const run = ACTIONS.get(`${job.provider}:${job.action}`);
  if (!run) {
    await finish(admin, job, {
      ok: false,
      retry: false,
      error: `No action ${job.provider}:${job.action}`,
    });
    return;
  }
  const connection = job.connection_id
    ? await getConnection(admin, job.connection_id)
    : null;
  if (!connection || connection.status !== "ok") {
    await admin
      .from("connector_jobs")
      .update({
        status: "skipped",
        last_error: connection ? "The connection needs reconnecting" : "Disconnected",
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return;
  }
  try {
    await usableTokens(admin, connection, fetcher);
    let outcome = await run(job, { admin, connection, fetch: fetcher });
    // Refused: refresh once and try again before giving up on the
    // connection (a refresh the provider refuses throws TokenError).
    if (!outcome.ok && outcome.auth && connection.tokens.refreshToken) {
      await usableTokens(admin, connection, fetcher, { force: true });
      outcome = await run(job, { admin, connection, fetch: fetcher });
    }
    if (!outcome.ok && outcome.auth)
      await markConnection(admin, connection.id, "invalid");
    await finish(admin, job, outcome);
  } catch (error) {
    const auth = error instanceof TokenError;
    await finish(admin, job, {
      ok: false,
      retry: !auth,
      error: auth
        ? "The connection was refused; reconnect it"
        : error instanceof Error
          ? error.message
          : "failed",
    });
  }
}

/** Puts a job back in the queue (manual replay): a failed or given-up
 * one, or an app sync skipped because the app wasn't connected — it goes
 * out on the workspace's current connection. The same row and
 * idempotency key: safe by construction. */
export async function replayJob(admin: Client, jobId: string): Promise<boolean> {
  const { data: job } = await admin
    .from("connector_jobs")
    .select("id, status, action, provider, workspace_id, last_error, connection_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || !isReplayable(job)) return false;
  let connectionId = job.connection_id;
  if (job.action === "sync_response") {
    const current = await findConnection(admin, job.workspace_id, job.provider);
    connectionId = current?.status === "ok" ? current.id : null;
    if (!connectionId) return false;
  }
  const { data } = await admin
    .from("connector_jobs")
    .update({
      status: "pending",
      connection_id: connectionId,
      attempt_count: 0,
      last_error: null,
      // A minute back: due at once even if this server's clock is ahead
      // of the database's.
      next_attempt_at: new Date(Date.now() - 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", job.status)
    .select("id");
  return Boolean(data?.length);
}

/** An HTTP call to a provider, classified for the worker: 401/403 are
 * auth problems, 429 and 5xx retry, other 4xx don't. */
export async function providerCall(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit & { token: string },
): Promise<
  { ok: true; status: number; data: unknown } | { ok: false; result: ActionResult }
> {
  const { token, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetcher(url, {
      ...rest,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(rest.body ? { "content-type": "application/json" } : {}),
        ...(headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return {
      ok: false,
      result: { ok: false, retry: true, error: `Network: ${(error as Error).message}` },
    };
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (res.ok) return { ok: true, status: res.status, data };
  const message = `HTTP ${res.status}: ${describeError(data)}`.slice(0, 400);
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      result: { ok: false, retry: false, error: message, auth: res.status === 401 },
    };
  }
  return {
    ok: false,
    result: { ok: false, retry: res.status === 429 || res.status >= 500, error: message },
  };
}

/** The provider's own words: Salesforce answers with an array of
 * errors, Zoho with `data[0]`, Notion and Mailchimp with message/detail,
 * Airtable and Pipedrive with `error`. Field names are kept. */
export function describeError(data: unknown): string {
  if (typeof data === "string") return data.slice(0, 200);
  if (Array.isArray(data)) return describeError(data[0]);
  const o = (data ?? {}) as Record<string, unknown>;
  if (Array.isArray(o.data) && o.data.length) return describeError(o.data[0]);
  const nested = o.error as Record<string, unknown> | string | undefined;
  const message = String(
    (typeof nested === "object" ? nested?.message : nested) ??
      o.message ??
      o.detail ??
      o.title ??
      "error",
  );
  const details = o.details as { api_name?: unknown } | undefined;
  const fields = Array.isArray(o.fields) ? o.fields.join(", ") : details?.api_name;
  return (
    typeof fields === "string" && fields ? `${message} (${fields})` : message
  ).slice(0, 200);
}
