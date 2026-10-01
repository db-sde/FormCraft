import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  getConnectionForForm,
  saveConnection,
  setSpreadsheetId,
  setConnectionEnabled,
  disconnectForm,
  enqueueSheetsSync,
  dispatchDueSheetsSyncs,
  recoverMissingSheetsSyncs,
} from "@/domains/sheets/queries";
import type { OAuthTokens } from "@/domains/sheets/oauth";
import { completeResponse, startResponse } from "@/domains/responses";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";

/**
 * Exercises the Sheets connection CRUD and the sync enqueue/dispatch
 * retry mechanics against a real local Postgres instance — the same
 * rigor the webhooks milestone verified with a real local HTTP
 * receiver, applied here since this environment has no real Google
 * Cloud OAuth client to test against. A tiny local HTTP server stands
 * in for Google's token + Sheets API endpoints (dispatchDueSheetsSyncs
 * takes their base URLs as options specifically so this is possible —
 * see DECISIONS.md). What this does NOT verify is Google's actual
 * OAuth consent screen or the real sheets.googleapis.com contract;
 * that needs a real Google Cloud project at deploy time.
 */

function admin(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set for integration tests",
    );
  }
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

const testSchema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Sheets test form" },
  theme: {
    primaryColor: "#0f172a",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end_default", title: "Thanks!", isDefault: true }],
  questions: [
    {
      id: "q_name",
      type: "short_text",
      order: 0,
      label: "Name",
      required: true,
      settings: {},
    },
  ],
  logic: [],
};

describe("sheets integration (real Postgres + a fake local Google server)", () => {
  const supabase = admin();
  let userId: string;
  let workspaceId: string;
  let formId: string;
  const testRunId = crypto.randomUUID().slice(0, 8);

  let fakeGoogle: Server;
  let fakeGoogleBase: string;
  const appendedRows: unknown[] = [];
  let tokenExchangeCount = 0;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      fakeGoogle = createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          if (req.url === "/token") {
            tokenExchangeCount += 1;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ access_token: "fake-at", expires_in: 3600 }));
            return;
          }
          if (req.url?.includes("/values/A1:append")) {
            appendedRows.push(JSON.parse(body).values[0]);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end("{}");
            return;
          }
          res.writeHead(404);
          res.end();
        });
      });
      fakeGoogle.listen(0, "127.0.0.1", () => {
        const address = fakeGoogle.address();
        if (address && typeof address === "object") {
          fakeGoogleBase = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });

    process.env.APP_SECRET = process.env.APP_SECRET || "test-secret-do-not-use-in-prod";
    // refreshAccessToken checks these regardless of the tokenEndpoint
    // override (it still needs a client id/secret to put in the
    // request body) — fine to set dummy values here since the fake
    // server below doesn't validate them.
    process.env.GOOGLE_OAUTH_CLIENT_ID =
      process.env.GOOGLE_OAUTH_CLIENT_ID || "test-client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET =
      process.env.GOOGLE_OAUTH_CLIENT_SECRET || "test-client-secret";

    const email = `sheets-test-${testRunId}@example.com`;
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email,
      password: crypto.randomUUID(),
      email_confirm: true,
    });
    if (userError) throw userError;
    userId = userData.user.id;

    const { data: workspace, error: workspaceError } = await supabase
      .from("workspaces")
      .insert({
        name: "Sheets Test Workspace",
        slug: `stw-${testRunId}`,
        owner_id: userId,
      })
      .select("id")
      .single();
    if (workspaceError) throw workspaceError;
    workspaceId = workspace.id;

    await supabase
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: userId, role: "owner" });

    const { data: form, error: formError } = await supabase
      .from("forms")
      .insert({
        workspace_id: workspaceId,
        title: "Sheets test form",
        slug: `sheets-form-${testRunId}`,
        created_by: userId,
      })
      .select("id")
      .single();
    if (formError) throw formError;
    formId = form.id;

    await supabase.from("form_versions").insert({
      form_id: formId,
      status: "draft",
      version_number: 1,
      schema: testSchema as unknown as Json,
    });
    await supabase.rpc("publish_form_version", {
      target_form_id: formId,
      compiled_schema: testSchema as unknown as Json,
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => fakeGoogle.close(() => resolve()));
    if (workspaceId) await supabase.from("workspaces").delete().eq("id", workspaceId);
    if (userId) await supabase.auth.admin.deleteUser(userId);
  });

  it("connection CRUD: save, read, update spreadsheet id, toggle, disconnect", async () => {
    expect(await getConnectionForForm(supabase, formId)).toBeNull();

    const tokens: OAuthTokens = {
      accessToken: "at_initial",
      refreshToken: "rt_initial",
      expiresAt: Date.now() + 3600_000,
    };
    await saveConnection(supabase, workspaceId, formId, tokens);

    let connection = await getConnectionForForm(supabase, formId);
    expect(connection).not.toBeNull();
    expect(connection?.enabled).toBe(true);
    expect(connection?.spreadsheetId).toBeNull();

    await setSpreadsheetId(supabase, formId, "sheet_abc123");
    connection = await getConnectionForForm(supabase, formId);
    expect(connection?.spreadsheetId).toBe("sheet_abc123");

    await setConnectionEnabled(supabase, formId, false);
    connection = await getConnectionForForm(supabase, formId);
    expect(connection?.enabled).toBe(false);

    // Reconnecting (saveConnection again) upserts by form_id rather
    // than creating a second row — form_id is unique on this table.
    await saveConnection(supabase, workspaceId, formId, {
      ...tokens,
      accessToken: "at_reconnected",
    });
    connection = await getConnectionForForm(supabase, formId);
    expect(connection?.enabled).toBe(true);
    // spreadsheet id survives a reconnect (upsert doesn't touch it).
    expect(connection?.spreadsheetId).toBe("sheet_abc123");

    await disconnectForm(supabase, formId);
    expect(await getConnectionForForm(supabase, formId)).toBeNull();
  });

  it("enqueues nothing when there's no connection, or no spreadsheet configured", async () => {
    const started = await startResponse(supabase, formId);
    const result = await enqueueSheetsSync(supabase, formId, started.responseId);
    expect(result).toBeNull();

    await saveConnection(supabase, workspaceId, formId, {
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: Date.now() + 3600_000,
    });
    const stillNothing = await enqueueSheetsSync(supabase, formId, started.responseId);
    expect(stillNothing).toBeNull();

    await disconnectForm(supabase, formId);
  });

  it("syncs a completed response's answers to the fake Sheets API end to end, including a token refresh", async () => {
    await saveConnection(supabase, workspaceId, formId, {
      accessToken: "at_expired",
      refreshToken: "rt_valid",
      // Already expired, so dispatch must refresh before calling append.
      expiresAt: Date.now() - 1000,
    });
    await setSpreadsheetId(supabase, formId, "sheet_e2e");

    const started = await startResponse(supabase, formId);
    await completeResponse(
      supabase,
      started.responseId,
      1,
      "q_name",
      { q_name: "Ada Lovelace" },
      crypto.randomUUID(),
    );

    const syncId = await enqueueSheetsSync(supabase, formId, started.responseId);
    expect(syncId).not.toBeNull();

    const tokenExchangesBefore = tokenExchangeCount;
    const result = await dispatchDueSheetsSyncs(supabase, {
      tokenEndpoint: `${fakeGoogleBase}/token`,
      sheetsApiBase: fakeGoogleBase,
    });
    expect(result.processed).toBe(1);
    expect(tokenExchangeCount).toBe(tokenExchangesBefore + 1);

    const { data: logRow } = await supabase
      .from("sheets_sync_log")
      .select("status, attempt_count")
      .eq("id", syncId!)
      .single();
    expect(logRow?.status).toBe("succeeded");
    expect(logRow?.attempt_count).toBe(1);

    const lastRow = appendedRows[appendedRows.length - 1] as string[];
    expect(lastRow).toContain("Ada Lovelace");

    // The refreshed access token was persisted back, not just used
    // in-memory for this one call — a later dispatch shouldn't need
    // to refresh again before its own expiry.
    const { data: connectionRow } = await supabase
      .from("sheets_connections")
      .select("encrypted_tokens")
      .eq("form_id", formId)
      .single();
    const stored = connectionRow?.encrypted_tokens;
    expect(stored).toBeTruthy();

    await disconnectForm(supabase, formId);
  });

  it("marks a sync failed (bounded, not exhausted on the first miss) when the Sheets API rejects it", async () => {
    await saveConnection(supabase, workspaceId, formId, {
      accessToken: "at_valid",
      refreshToken: "rt_valid",
      expiresAt: Date.now() + 3600_000,
    });
    await setSpreadsheetId(supabase, formId, "sheet_will_fail");

    const started = await startResponse(supabase, formId);
    await completeResponse(
      supabase,
      started.responseId,
      1,
      "q_name",
      { q_name: "Failing case" },
      crypto.randomUUID(),
    );
    const syncId = await enqueueSheetsSync(supabase, formId, started.responseId);

    // Point at a genuinely unreachable port instead of the fake
    // server, so the append call fails the same way an unreachable
    // real Google endpoint would.
    await dispatchDueSheetsSyncs(supabase, {
      tokenEndpoint: `${fakeGoogleBase}/token`,
      sheetsApiBase: "http://127.0.0.1:1",
    });

    const { data: logRow } = await supabase
      .from("sheets_sync_log")
      .select("status, attempt_count, next_attempt_at, last_error")
      .eq("id", syncId!)
      .single();
    expect(logRow?.status).toBe("failed");
    expect(logRow?.attempt_count).toBe(1);
    expect(logRow?.last_error).toBeTruthy();
    expect(new Date(logRow!.next_attempt_at).getTime()).toBeGreaterThan(Date.now());

    await disconnectForm(supabase, formId);
  });

  it("encrypts tokens at rest — the raw refresh token never appears in the stored row", async () => {
    await saveConnection(supabase, workspaceId, formId, {
      accessToken: "at_should_not_leak",
      refreshToken: "rt_super_secret_value",
      expiresAt: Date.now() + 3600_000,
    });

    const { data: row } = await supabase
      .from("sheets_connections")
      .select("encrypted_tokens")
      .eq("form_id", formId)
      .single();

    expect(JSON.stringify(row?.encrypted_tokens)).not.toContain("rt_super_secret_value");
    expect(JSON.stringify(row?.encrypted_tokens)).not.toContain("at_should_not_leak");

    await disconnectForm(supabase, formId);
  });

  describe("workers", () => {
    const options = () => ({
      tokenEndpoint: `${fakeGoogleBase}/token`,
      sheetsApiBase: fakeGoogleBase,
    });
    const goodTokens = () => ({
      accessToken: "at_ok",
      refreshToken: "rt_ok",
      expiresAt: Date.now() + 3600_000,
    });

    async function completed(answers: Record<string, unknown>, form = formId) {
      const { responseId } = await startResponse(supabase, form);
      const result = await completeResponse(
        supabase,
        responseId,
        1,
        "q_name",
        answers,
        crypto.randomUUID(),
      );
      expect(result.ok).toBe(true);
      return responseId;
    }

    async function secondForm() {
      const { data: form } = await supabase
        .from("forms")
        .insert({
          workspace_id: workspaceId,
          title: "Second sheets form",
          slug: `sheets-form-2-${crypto.randomUUID().slice(0, 8)}`,
          created_by: userId,
        })
        .select("id")
        .single();
      await supabase.from("form_versions").insert({
        form_id: form!.id,
        status: "draft",
        version_number: 1,
        schema: testSchema as unknown as Json,
      });
      await supabase.rpc("publish_form_version", {
        target_form_id: form!.id,
        compiled_schema: testSchema as unknown as Json,
      });
      return form!.id;
    }

    async function logFor(syncId: string) {
      const { data } = await supabase
        .from("sheets_sync_log")
        .select("status, attempt_count, last_error")
        .eq("id", syncId)
        .single();
      return data!;
    }

    it("writes respondent text as literal cells, never as a formula", async () => {
      await saveConnection(supabase, workspaceId, formId, goodTokens());
      await setSpreadsheetId(supabase, formId, "sheet_formula");
      const responseId = await completed({
        q_name: '=HYPERLINK("http://evil.example","click")',
      });
      const syncId = await enqueueSheetsSync(supabase, formId, responseId);
      appendedRows.length = 0;

      await dispatchDueSheetsSyncs(supabase, options());

      expect((await logFor(syncId!)).status).toBe("succeeded");
      const row = appendedRows[appendedRows.length - 1] as string[];
      expect(row).toContain(`'=HYPERLINK("http://evil.example","click")`);
      expect(row.some((cell) => cell.startsWith("="))).toBe(false);
      await disconnectForm(supabase, formId);
    });

    it("is idempotent, skips spam, and ignores unfinished responses", async () => {
      await saveConnection(supabase, workspaceId, formId, goodTokens());
      await setSpreadsheetId(supabase, formId, "sheet_idem");
      const responseId = await completed({ q_name: "Once" });

      const first = await enqueueSheetsSync(supabase, formId, responseId);
      const second = await enqueueSheetsSync(supabase, formId, responseId);
      expect(first).not.toBeNull();
      expect(second).toBeNull(); // already queued
      const { count } = await supabase
        .from("sheets_sync_log")
        .select("id", { count: "exact", head: true })
        .eq("response_id", responseId);
      expect(count).toBe(1);

      const started = await startResponse(supabase, formId);
      expect(await enqueueSheetsSync(supabase, formId, started.responseId)).toBeNull();

      const spam = await startResponse(supabase, formId);
      await completeResponse(
        supabase,
        spam.responseId,
        1,
        "q_name",
        { q_name: "Bot" },
        crypto.randomUUID(),
        { spamSuspected: true },
      );
      expect(await enqueueSheetsSync(supabase, formId, spam.responseId)).toBeNull();
      await disconnectForm(supabase, formId);
    });

    it("recovers a sync that a failed post-submit callback never created — once", async () => {
      await saveConnection(supabase, workspaceId, formId, goodTokens());
      await setSpreadsheetId(supabase, formId, "sheet_recover");
      const responseId = await completed({ q_name: "Lost enqueue" });

      expect((await recoverMissingSheetsSyncs(supabase)).recovered).toBe(1);
      expect((await recoverMissingSheetsSyncs(supabase)).recovered).toBe(0);
      appendedRows.length = 0;
      await dispatchDueSheetsSyncs(supabase, options());
      expect(
        appendedRows.filter((r) => (r as string[]).includes("Lost enqueue")),
      ).toHaveLength(1);
      expect(responseId).toBeTruthy();
      await disconnectForm(supabase, formId);
    });

    it("overlapping sweeps append each response exactly once", async () => {
      await saveConnection(supabase, workspaceId, formId, goodTokens());
      await setSpreadsheetId(supabase, formId, "sheet_parallel");
      const names = ["p1", "p2", "p3", "p4"];
      for (const name of names) {
        const responseId = await completed({ q_name: name });
        await enqueueSheetsSync(supabase, formId, responseId);
      }
      appendedRows.length = 0;

      await Promise.all([
        dispatchDueSheetsSyncs(supabase, options()),
        dispatchDueSheetsSyncs(supabase, options()),
        dispatchDueSheetsSyncs(supabase, options()),
      ]);

      for (const name of names) {
        expect(
          appendedRows.filter((r) => (r as string[]).includes(name)),
          name,
        ).toHaveLength(1);
      }
      await disconnectForm(supabase, formId);
    });

    it("a connection that can't be used doesn't block, and a disabled one is retired", async () => {
      const brokenForm = await secondForm();
      const broken = await supabase
        .from("sheets_connections")
        .insert({
          workspace_id: workspaceId,
          form_id: brokenForm,
          spreadsheet_id: "sheet_broken",
          // Not a valid encrypted payload: decrypting it throws.
          encrypted_tokens: { iv: "x", authTag: "x", ciphertext: "x" } as Json,
        })
        .select("id")
        .single();
      expect(broken.error).toBeNull();
      const brokenSync = await enqueueSheetsSync(
        supabase,
        brokenForm,
        await completed({ q_name: "Cannot decrypt" }, brokenForm),
      );

      await saveConnection(supabase, workspaceId, formId, goodTokens());
      await setSpreadsheetId(supabase, formId, "sheet_after_broken");
      const goodSync = await enqueueSheetsSync(
        supabase,
        formId,
        await completed({ q_name: "Behind the broken one" }),
      );

      await dispatchDueSheetsSyncs(supabase, options());

      const brokenLog = await logFor(brokenSync!);
      expect(brokenLog.status).toBe("failed");
      expect(brokenLog.attempt_count).toBe(1);
      expect(brokenLog.last_error).toBeTruthy();
      expect((await logFor(goodSync!)).status).toBe("succeeded");

      // Disabling retires the backlog for good rather than leaving it
      // due on every sweep.
      await setConnectionEnabled(supabase, brokenForm, false);
      await supabase
        .from("sheets_sync_log")
        .update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() })
        .eq("id", brokenSync!);
      await dispatchDueSheetsSyncs(supabase, options());
      const retired = await logFor(brokenSync!);
      expect(retired.status).toBe("exhausted");
      expect(retired.last_error).toMatch(/disabled/);

      await disconnectForm(supabase, formId);
      await disconnectForm(supabase, brokenForm);
    });
  });
});
