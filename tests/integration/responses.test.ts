import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  startResponse,
  saveResponseAnswers,
  completeResponse,
  StaleResponseWriteError,
  purgeExpiredUnfinishedResponses,
} from "@/domains/responses";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";

/**
 * Exercises the response engine (start/autosave/complete) against a
 * real local Postgres instance via the service-role client, the same
 * way the public API route handlers do. Requires `supabase start` to
 * be running locally — see docs/testing.md.
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
  meta: { title: "Integration test form" },
  theme: {
    primaryColor: "#0f172a",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end_default", title: "Thanks!", isDefault: true }],
  questions: [
    {
      id: "q_welcome",
      type: "welcome_screen",
      order: 0,
      label: "Welcome",
      required: false,
      settings: {},
    },
    {
      id: "q_name",
      type: "short_text",
      order: 1,
      label: "Name",
      required: true,
      settings: {},
    },
    {
      id: "q_notes",
      type: "long_text",
      order: 2,
      label: "Notes",
      required: false,
      settings: {},
    },
  ],
  logic: [],
};

describe("response engine (integration)", () => {
  const supabase = admin();
  let userId: string;
  let workspaceId: string;
  let formId: string;
  const testRunId = crypto.randomUUID().slice(0, 8);

  beforeAll(async () => {
    const email = `response-engine-test-${testRunId}@example.com`;
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
        name: "Integration Test Workspace",
        slug: `itw-${testRunId}`,
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
        title: "Test form",
        slug: `test-form-${testRunId}`,
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
    if (workspaceId) await supabase.from("workspaces").delete().eq("id", workspaceId);
    if (userId) await supabase.auth.admin.deleteUser(userId);
  });

  it("start → autosave → complete happy path", async () => {
    const started = await startResponse(supabase, formId);
    expect(started.responseId).toBeTruthy();

    const saved = await saveResponseAnswers(supabase, started.responseId, 1, "q_name", {
      q_name: "Ada Lovelace",
    });
    expect(saved.status).toBe("partial");
    expect(saved.revision).toBe(1);

    const completed = await completeResponse(
      supabase,
      started.responseId,
      2,
      "q_notes",
      { q_name: "Ada Lovelace", q_notes: "hello" },
      crypto.randomUUID(),
    );
    expect(completed.ok).toBe(true);
    if (completed.ok) {
      expect(completed.endingId).toBe("end_default");
      expect(completed.formId).toBe(formId);
      expect(completed.alreadyCompleted).toBe(false);
    }

    const { data: row } = await supabase
      .from("responses")
      .select("status, ending_id")
      .eq("id", started.responseId)
      .single();
    expect(row?.status).toBe("completed");
    expect(row?.ending_id).toBe("end_default");
  });

  it("rejects a stale (out-of-order) autosave without corrupting the newer state", async () => {
    const started = await startResponse(supabase, formId);

    await saveResponseAnswers(supabase, started.responseId, 5, "q_name", {
      q_name: "newer",
    });

    await expect(
      saveResponseAnswers(supabase, started.responseId, 3, "q_name", {
        q_name: "older, should be rejected",
      }),
    ).rejects.toThrow(StaleResponseWriteError);

    const { data: answer } = await supabase
      .from("answers")
      .select("value")
      .eq("response_id", started.responseId)
      .eq("question_id", "q_name")
      .single();
    expect(answer?.value).toBe("newer");
  });

  it("rejects completion when a reachable required question is unanswered", async () => {
    const started = await startResponse(supabase, formId);

    const result = await completeResponse(
      supabase,
      started.responseId,
      1,
      "q_name",
      {},
      crypto.randomUUID(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missingQuestionIds).toContain("q_name");

    const { data: row } = await supabase
      .from("responses")
      .select("status")
      .eq("id", started.responseId)
      .single();
    expect(row?.status).toBe("in_progress");
  });

  it("is idempotent: completing an already-completed response returns the same ending without erroring", async () => {
    const started = await startResponse(supabase, formId);
    const key = crypto.randomUUID();

    const first = await completeResponse(
      supabase,
      started.responseId,
      1,
      "q_name",
      { q_name: "Ada" },
      key,
    );
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.alreadyCompleted).toBe(false);

    const retry = await completeResponse(
      supabase,
      started.responseId,
      1,
      "q_name",
      { q_name: "Ada" },
      key,
    );
    expect(retry.ok).toBe(true);
    if (first.ok && retry.ok) {
      expect(retry.endingId).toBe(first.endingId);
      // The route handler uses this flag to skip sending a second
      // notification email for what is, respondent-side, just a retry
      // of the same submission.
      expect(retry.alreadyCompleted).toBe(true);
    }
  });

  it("never regresses a completed response back to partial via a late autosave", async () => {
    const started = await startResponse(supabase, formId);
    await completeResponse(
      supabase,
      started.responseId,
      1,
      "q_name",
      { q_name: "Ada" },
      crypto.randomUUID(),
    );

    const lateAutosave = await saveResponseAnswers(
      supabase,
      started.responseId,
      99,
      "q_notes",
      {
        q_notes: "too late",
      },
    );
    expect(lateAutosave.status).toBe("completed");

    const { data: row } = await supabase
      .from("responses")
      .select("status")
      .eq("id", started.responseId)
      .single();
    expect(row?.status).toBe("completed");
  });

  it("drops answer keys for question ids that don't exist on this form's schema (adversarial: forged question id)", async () => {
    const started = await startResponse(supabase, formId);

    await saveResponseAnswers(supabase, started.responseId, 1, "q_name", {
      q_name: "Ada Lovelace",
      forged_question_id_from_another_form: "should never be stored",
    });

    const { data: rows } = await supabase
      .from("answers")
      .select("question_id")
      .eq("response_id", started.responseId);
    const storedQuestionIds = (rows ?? []).map((r) => r.question_id);
    expect(storedQuestionIds).toContain("q_name");
    expect(storedQuestionIds).not.toContain("forged_question_id_from_another_form");

    const completed = await completeResponse(
      supabase,
      started.responseId,
      2,
      "q_name",
      {
        q_name: "Ada Lovelace",
        q_notes: "hello",
        another_forged_id: "also should never be stored",
      },
      crypto.randomUUID(),
    );
    expect(completed.ok).toBe(true);

    const { data: finalRows } = await supabase
      .from("answers")
      .select("question_id")
      .eq("response_id", started.responseId);
    const finalQuestionIds = (finalRows ?? []).map((r) => r.question_id);
    expect(finalQuestionIds.sort()).toEqual(["q_name", "q_notes"]);
    expect(finalQuestionIds).not.toContain("another_forged_id");
  });

  it("stays in_progress until an actual answer is saved, then becomes partial", async () => {
    const { responseId } = await startResponse(supabase, formId, {
      utmSource: "newsletter",
      utmTerm: "forms",
    });

    // Moved past the welcome screen, nothing answered yet.
    const moved = await saveResponseAnswers(supabase, responseId, 1, "q_name", {});
    expect(moved.status).toBe("in_progress");

    const answered = await saveResponseAnswers(supabase, responseId, 2, "q_name", {
      q_name: "Grace",
    });
    expect(answered.status).toBe("partial");

    const { data } = await supabase
      .from("responses")
      .select("utm_source, utm_term")
      .eq("id", responseId)
      .single();
    expect(data).toEqual({ utm_source: "newsletter", utm_term: "forms" });
  });

  it("counts drop-off only for sessions idle past the abandonment threshold", async () => {
    const idle = await startResponse(supabase, formId);
    await saveResponseAnswers(supabase, idle.responseId, 1, "q_notes", { q_name: "A" });
    const active = await startResponse(supabase, formId);
    await saveResponseAnswers(supabase, active.responseId, 1, "q_notes", { q_name: "B" });
    // Make the first one look 2 hours stale.
    await supabase
      .from("responses")
      .update({ last_active_at: new Date(Date.now() - 2 * 3600_000).toISOString() })
      .eq("id", idle.responseId);

    const { data, error } = await supabase.rpc("response_dropoff", {
      target_form_id: formId,
      idle_minutes: 30,
    });
    expect(error).toBeNull();
    const notes = (data ?? []).find((row) => row.question_id === "q_notes");
    // Only the idle session counts (earlier tests may add others at
    // different questions, but none idle at q_notes besides this one).
    expect(notes?.stopped).toBe(1);
  });

  it("stores nothing before submit when the form doesn't save unfinished answers", async () => {
    await supabase
      .from("forms")
      .update({ save_partial_responses: false })
      .eq("id", formId);
    try {
      const { responseId } = await startResponse(supabase, formId);
      const result = await saveResponseAnswers(supabase, responseId, 1, "q_name", {
        q_name: "Private",
      });
      expect(result.status).toBe("in_progress");
      const { data: answers } = await supabase
        .from("answers")
        .select("question_id")
        .eq("response_id", responseId);
      expect(answers).toEqual([]);
    } finally {
      await supabase
        .from("forms")
        .update({ save_partial_responses: true })
        .eq("id", formId);
    }
  });

  it("retention deletes only unfinished responses past the form's period", async () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const stale = await startResponse(supabase, formId);
    await saveResponseAnswers(supabase, stale.responseId, 1, "q_name", { q_name: "Old" });
    const done = await startResponse(supabase, formId);
    await completeResponse(
      supabase,
      done.responseId,
      1,
      "q_notes",
      { q_name: "Done" },
      crypto.randomUUID(),
    );
    await supabase
      .from("responses")
      .update({ last_active_at: old })
      .in("id", [stale.responseId, done.responseId]);

    await supabase.from("forms").update({ partial_retention_days: 30 }).eq("id", formId);
    try {
      const { deleted } = await purgeExpiredUnfinishedResponses(supabase);
      expect(deleted).toBeGreaterThanOrEqual(1);
      const { data } = await supabase
        .from("responses")
        .select("id")
        .in("id", [stale.responseId, done.responseId]);
      expect(data?.map((r) => r.id)).toEqual([done.responseId]);
    } finally {
      await supabase
        .from("forms")
        .update({ partial_retention_days: null })
        .eq("id", formId);
    }
  });
});
