import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { AnswerMap } from "@/domains/logic";
import { encryptJson, decryptJson, type EncryptedPayload } from "./crypto";
import { refreshAccessToken, needsRefresh, type OAuthTokens } from "./oauth";
import { appendRowToSheet } from "./append";
import { buildResponseRowForSheet } from "./row";
import { nextBackoffDelayMs, isExhausted } from "@/domains/webhooks/backoff";

type Client = SupabaseClient<Database>;

export type SheetsConnection = {
  id: string;
  formId: string;
  spreadsheetId: string | null;
  enabled: boolean;
  createdAt: string;
};

export async function getConnectionForForm(
  supabase: Client,
  formId: string,
): Promise<SheetsConnection | null> {
  const { data, error } = await supabase
    .from("sheets_connections")
    .select("id, form_id, spreadsheet_id, enabled, created_at")
    .eq("form_id", formId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    formId: data.form_id,
    spreadsheetId: data.spreadsheet_id,
    enabled: data.enabled,
    createdAt: data.created_at,
  };
}

/** Called from the OAuth callback right after a successful token
 * exchange. `form_id` is unique on this table, so reconnecting the
 * same form replaces its stored tokens rather than creating a second
 * row. */
export async function saveConnection(
  supabase: Client,
  workspaceId: string,
  formId: string,
  tokens: OAuthTokens,
): Promise<void> {
  const { error } = await supabase.from("sheets_connections").upsert(
    {
      workspace_id: workspaceId,
      form_id: formId,
      encrypted_tokens: encryptJson(tokens) as unknown as Json,
      enabled: true,
    },
    { onConflict: "form_id" },
  );
  if (error) throw error;
}

export async function setSpreadsheetId(
  supabase: Client,
  formId: string,
  spreadsheetId: string,
): Promise<void> {
  const { error } = await supabase
    .from("sheets_connections")
    .update({ spreadsheet_id: spreadsheetId })
    .eq("form_id", formId);
  if (error) throw error;
}

export async function setConnectionEnabled(
  supabase: Client,
  formId: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("sheets_connections")
    .update({ enabled })
    .eq("form_id", formId);
  if (error) throw error;
}

export async function disconnectForm(supabase: Client, formId: string): Promise<void> {
  const { error } = await supabase
    .from("sheets_connections")
    .delete()
    .eq("form_id", formId);
  if (error) throw error;
}

export type SyncLogEntry = {
  id: string;
  status: "pending" | "succeeded" | "failed" | "exhausted";
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
};

export async function listSyncLog(
  supabase: Client,
  connectionId: string,
): Promise<SyncLogEntry[]> {
  const { data, error } = await supabase
    .from("sheets_sync_log")
    .select("id, status, attempt_count, last_error, created_at")
    .eq("connection_id", connectionId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    createdAt: row.created_at,
  }));
}

/** Enqueues a sync for a completed response, only if the form has an
 * enabled connection with a spreadsheet configured. Mirrors
 * enqueueWebhookDeliveries: separate from the actual Sheets API call (so
 * a slow Google can never affect the respondent) and idempotent — one
 * row per connection + response, so a retry or the recovery sweep can't
 * append the same response twice. Spam-flagged and unfinished responses
 * are skipped. Returns the new row's id, or null if nothing was added. */
export async function enqueueSheetsSync(
  admin: Client,
  formId: string,
  responseId: string,
): Promise<string | null> {
  const { data: response, error: responseError } = await admin
    .from("responses")
    .select("status, spam_suspected")
    .eq("id", responseId)
    .maybeSingle();
  if (responseError) throw responseError;
  if (!response || response.status !== "completed" || response.spam_suspected)
    return null;

  const { data: connection, error } = await admin
    .from("sheets_connections")
    .select("id, spreadsheet_id, enabled")
    .eq("form_id", formId)
    .maybeSingle();
  if (error) throw error;
  if (!connection || !connection.enabled || !connection.spreadsheet_id) return null;

  const { data: inserted, error: insertError } = await admin
    .from("sheets_sync_log")
    .upsert(
      { connection_id: connection.id, response_id: responseId, status: "pending" },
      { onConflict: "connection_id,response_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  if (insertError) throw insertError;

  return inserted?.id ?? null;
}

const RECOVERY_BATCH = 200;

/** Creates the syncs a completed response should have but doesn't (the
 * post-response callback failed or was killed). Run by the cron sweep
 * before dispatching. */
export async function recoverMissingSheetsSyncs(
  admin: Client,
): Promise<{ recovered: number }> {
  const { data, error } = await admin.rpc("responses_missing_sheets_sync", {
    p_limit: RECOVERY_BATCH,
  });
  if (error) throw error;

  let recovered = 0;
  for (const row of data ?? []) {
    const { data: inserted, error: insertError } = await admin
      .from("sheets_sync_log")
      .upsert(
        {
          connection_id: row.connection_id,
          response_id: row.response_id,
          status: "pending",
        },
        { onConflict: "connection_id,response_id", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();
    if (insertError) throw insertError;
    if (inserted) recovered += 1;
  }
  return { recovered };
}

export type SyncAttemptResult = {
  status: "succeeded" | "failed" | "exhausted";
  error?: string;
};

async function attemptSync(
  admin: Client,
  connection: {
    id: string;
    encrypted_tokens: Json;
    spreadsheet_id: string | null;
    form_id: string;
  },
  responseId: string,
  options?: { tokenEndpoint?: string; sheetsApiBase?: string },
): Promise<SyncAttemptResult> {
  if (!connection.spreadsheet_id) {
    return { status: "failed", error: "no spreadsheet configured" };
  }

  let tokens = decryptJson<OAuthTokens>(
    connection.encrypted_tokens as unknown as EncryptedPayload,
  );

  if (needsRefresh(tokens.expiresAt)) {
    const refreshed = await refreshAccessToken(
      tokens.refreshToken,
      options?.tokenEndpoint,
    );
    tokens = {
      ...tokens,
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
    };
    const { error: tokenUpdateError } = await admin
      .from("sheets_connections")
      .update({ encrypted_tokens: encryptJson(tokens) as unknown as Json })
      .eq("id", connection.id);
    if (tokenUpdateError) throw tokenUpdateError;
  }

  const { data: response } = await admin
    .from("responses")
    .select("ending_id")
    .eq("id", responseId)
    .maybeSingle();
  const { data: answerRows } = await admin
    .from("answers")
    .select("question_id, value")
    .eq("response_id", responseId);
  const answers: AnswerMap = Object.fromEntries(
    (answerRows ?? []).map((a) => [a.question_id, a.value]),
  );

  const row = await buildResponseRowForSheet(
    admin,
    connection.form_id,
    responseId,
    answers,
    response?.ending_id ?? null,
  );

  try {
    await appendRowToSheet(
      tokens.accessToken,
      connection.spreadsheet_id,
      row.values,
      options?.sheetsApiBase,
    );
    return { status: "succeeded" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "sync failed",
    };
  }
}

const DISPATCH_BATCH_SIZE = 20;
/** See the same constant in the webhooks domain: a claimed job is
 * reserved for its worker for this long. */
const CLAIM_LEASE_SECONDS = 120;

async function recordSyncFailure(
  admin: Client,
  syncId: string,
  attemptCount: number,
  message: string,
) {
  const delayMs = nextBackoffDelayMs(attemptCount);
  await admin
    .from("sheets_sync_log")
    .update({
      status: isExhausted(attemptCount) ? "exhausted" : "failed",
      attempt_count: attemptCount,
      last_error: message.slice(0, 500),
      next_attempt_at: new Date(Date.now() + (delayMs ?? 0)).toISOString(),
    })
    .eq("id", syncId);
}

/** The retry sweep — mirrors dispatchDueDeliveries in
 * @/domains/webhooks/queries.ts: jobs are claimed (overlapping sweeps
 * never share one), each is isolated (a bad token or missing sheet is
 * recorded and the rest still run), and a connection that's disabled or
 * gone retires its jobs for good instead of leaving them due forever.
 * Invoked by /api/cron/sheets/dispatch. */
export async function dispatchDueSheetsSyncs(
  admin: Client,
  options?: { tokenEndpoint?: string; sheetsApiBase?: string },
): Promise<{ processed: number }> {
  const { data: due, error } = await admin.rpc("claim_due_sheets_syncs", {
    p_limit: DISPATCH_BATCH_SIZE,
    p_lease_seconds: CLAIM_LEASE_SECONDS,
  });
  if (error) throw error;
  if (!due || due.length === 0) return { processed: 0 };

  for (const sync of due) {
    const attemptCount = sync.attempt_count + 1;
    try {
      if (!sync.response_id) {
        await admin
          .from("sheets_sync_log")
          .update({ status: "exhausted", last_error: "missing response id" })
          .eq("id", sync.id);
        continue;
      }

      const { data: connection } = await admin
        .from("sheets_connections")
        .select("id, form_id, encrypted_tokens, spreadsheet_id, enabled")
        .eq("id", sync.connection_id)
        .maybeSingle();

      if (!connection || !connection.enabled) {
        await admin
          .from("sheets_sync_log")
          .update({ status: "exhausted", last_error: "connection disabled or deleted" })
          .eq("id", sync.id);
        continue;
      }

      const result = await attemptSync(admin, connection, sync.response_id, options);
      if (result.status === "succeeded") {
        await admin
          .from("sheets_sync_log")
          .update({ status: "succeeded", attempt_count: attemptCount, last_error: null })
          .eq("id", sync.id);
        continue;
      }
      await recordSyncFailure(
        admin,
        sync.id,
        attemptCount,
        result.error ?? "unknown error",
      );
    } catch (jobError) {
      await recordSyncFailure(
        admin,
        sync.id,
        attemptCount,
        jobError instanceof Error ? jobError.message : "sync failed",
      );
    }
  }

  return { processed: due.length };
}
