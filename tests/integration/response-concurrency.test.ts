import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  completeResponse,
  saveResponseAnswers,
  startResponse,
  StaleResponseWriteError,
} from "@/domains/responses";

/**
 * Response writes under concurrency and failure, against the real
 * database. Rather than sleeping and hoping for an interleaving, each
 * test fires many requests at once and asserts an invariant that holds
 * for *every* ordering the database could choose:
 *   - the stored answers always belong to the stored revision;
 *   - exactly one completion happens, whoever wins;
 *   - a rejected submission leaves no trace.
 */
const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const runId = crypto.randomUUID().slice(0, 8);

const schema = {
  schemaVersion: 1,
  meta: { title: "Concurrency" },
  theme: {},
  endings: [
    { id: "end_default", title: "Default", isDefault: true },
    { id: "end_vip", title: "VIP", isDefault: false },
  ],
  questions: [
    { id: "q_a", type: "short_text", order: 0, label: "A", required: true, settings: {} },
    {
      id: "q_branch",
      type: "yes_no",
      order: 1,
      label: "VIP?",
      required: true,
      settings: {},
    },
    {
      id: "q_skipped",
      type: "short_text",
      order: 2,
      label: "Only if no",
      required: false,
      settings: {},
    },
    {
      id: "q_vip",
      type: "short_text",
      order: 3,
      label: "VIP detail",
      required: false,
      settings: {},
    },
    {
      id: "q_file",
      type: "file_upload",
      order: 4,
      label: "File",
      required: false,
      settings: { acceptedMimeTypes: ["image/*"], maxSizeMb: 1 },
    },
  ],
  // Yes → skip "Only if no" and go straight to q_vip.
  logic: [
    {
      id: "rule1",
      questionId: "q_branch",
      operator: "equals",
      value: true,
      action: { type: "jump_to_question", questionId: "q_vip" },
    },
  ],
} as unknown as Json;

let userId: string;
let workspaceId: string;
let formId: string;

beforeAll(async () => {
  const { data: user, error } = await admin.auth.admin.createUser({
    email: `concurrency-${runId}@example.com`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (error) throw error;
  userId = user.user.id;
  const { data: workspace } = await admin
    .from("workspaces")
    .insert({ name: "Concurrency", slug: `conc-${runId}`, owner_id: userId })
    .select("id")
    .single();
  workspaceId = workspace!.id;
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Concurrency",
      slug: `conc-form-${runId}`,
      created_by: userId,
    })
    .select("id")
    .single();
  formId = form!.id;
  await admin
    .from("form_versions")
    .insert({ form_id: formId, status: "draft", version_number: 1, schema });
  const { error: publishError } = await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: schema,
  });
  if (publishError) throw publishError;
}, 60_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", workspaceId);
  await admin.auth.admin.deleteUser(userId);
});

async function answersOf(responseId: string) {
  const { data } = await admin
    .from("answers")
    .select("question_id, value")
    .eq("response_id", responseId);
  return Object.fromEntries((data ?? []).map((a) => [a.question_id, a.value]));
}

describe("autosave", () => {
  it("keeps answers and revision together under 40 simultaneous, shuffled saves", async () => {
    const { responseId } = await startResponse(admin, formId);
    const revisions = Array.from({ length: 40 }, (_, i) => i + 1).sort(
      () => Math.random() - 0.5,
    );

    const results = await Promise.allSettled(
      revisions.map((revision) =>
        // The value names the revision that wrote it.
        saveResponseAnswers(admin, responseId, revision, "q_a", {
          q_a: `rev-${revision}`,
        }),
      ),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(StaleResponseWriteError);
      }
    }

    const { data: row } = await admin
      .from("responses")
      .select("client_revision")
      .eq("id", responseId)
      .single();
    // Whatever order the database serialised them in, the highest
    // revision is the one that survives, with its own answer.
    expect(row?.client_revision).toBe(40);
    expect((await answersOf(responseId)).q_a).toBe("rev-40");
  });

  it("refuses an older revision after a newer one landed", async () => {
    const { responseId } = await startResponse(admin, formId);
    await saveResponseAnswers(admin, responseId, 5, "q_a", { q_a: "new" });
    await expect(
      saveResponseAnswers(admin, responseId, 3, "q_a", { q_a: "old" }),
    ).rejects.toMatchObject({ currentRevision: 5 });
    expect((await answersOf(responseId)).q_a).toBe("new");
  });
});

describe("completion", () => {
  const body = { q_a: "final", q_branch: false };

  it("a racing autosave can neither undo nor corrupt the completed answers", async () => {
    const { responseId } = await startResponse(admin, formId);
    await saveResponseAnswers(admin, responseId, 1, "q_a", { q_a: "draft" });

    const [complete] = await Promise.all([
      completeResponse(admin, responseId, 2, "q_a", body, crypto.randomUUID()),
      ...Array.from({ length: 10 }, (_, i) =>
        saveResponseAnswers(admin, responseId, 3 + i, "q_a", { q_a: `late-${i}` }).catch(
          () => undefined,
        ),
      ),
    ]);
    expect(complete.ok).toBe(true);

    const { data: row } = await admin
      .from("responses")
      .select("status")
      .eq("id", responseId)
      .single();
    expect(row?.status).toBe("completed");
    // Either the completion ran first (later autosaves are no-ops) or
    // an autosave did and the completion's answers then replaced it —
    // in both orders the submitted value is what's stored.
    expect((await answersOf(responseId)).q_a).toBe("final");
  });

  it("two simultaneous submits complete once; the other reports the same result", async () => {
    const { responseId } = await startResponse(admin, formId);
    const results = await Promise.all(
      [0, 1, 2, 3].map(() =>
        completeResponse(admin, responseId, 1, "q_a", body, crypto.randomUUID()),
      ),
    );
    for (const result of results) expect(result.ok).toBe(true);
    const fresh = results.filter((r) => r.ok && !r.alreadyCompleted);
    expect(fresh).toHaveLength(1);
    const endings = new Set(results.map((r) => (r.ok ? r.endingId : null)));
    expect(endings.size).toBe(1);
  });

  it("a rejected submission writes nothing — not even on a form that doesn't keep unfinished answers", async () => {
    await admin.from("forms").update({ save_partial_responses: false }).eq("id", formId);
    try {
      const { responseId } = await startResponse(admin, formId);
      const result = await completeResponse(
        admin,
        responseId,
        1,
        "q_a",
        { q_a: "private text", q_branch: undefined },
        crypto.randomUUID(),
      );
      expect(result.ok).toBe(false);
      expect(await answersOf(responseId)).toEqual({});
      const { data: row } = await admin
        .from("responses")
        .select("status, client_revision")
        .eq("id", responseId)
        .single();
      expect(row).toEqual({ status: "in_progress", client_revision: 0 });
    } finally {
      await admin.from("forms").update({ save_partial_responses: true }).eq("id", formId);
    }
  });

  it("keeps only answers on the path taken, dropping ones from an abandoned branch", async () => {
    const { responseId } = await startResponse(admin, formId);
    // They answered "Only if no", then went back and chose Yes (which
    // skips that question).
    await saveResponseAnswers(admin, responseId, 1, "q_skipped", {
      q_a: "x",
      q_branch: false,
      q_skipped: "stale branch answer",
    });
    const result = await completeResponse(
      admin,
      responseId,
      2,
      "q_vip",
      { q_a: "x", q_branch: true, q_skipped: "stale branch answer", q_vip: "vip" },
      crypto.randomUUID(),
    );
    expect(result.ok).toBe(true);
    expect(Object.keys(await answersOf(responseId)).sort()).toEqual([
      "q_a",
      "q_branch",
      "q_vip",
    ]);
  });

  it("only accepts a file answer that is a real upload of this response and question", async () => {
    const { responseId } = await startResponse(admin, formId);
    const other = await startResponse(admin, formId);
    const upload = async (rid: string) => {
      const { data } = await admin
        .from("uploads")
        .insert({
          response_id: rid,
          question_id: "q_file",
          storage_path: `${rid}/q_file/${crypto.randomUUID()}.png`,
          original_filename: "a.png",
          mime_type: "image/png",
          size_bytes: 1,
          status: "clean",
        })
        .select("id")
        .single();
      return data!.id;
    };
    const base = { q_a: "x", q_branch: false };

    const forged = await completeResponse(
      admin,
      responseId,
      1,
      "q_file",
      { ...base, q_file: "not-an-upload-id" },
      crypto.randomUUID(),
    );
    expect(forged.ok).toBe(false);

    const someoneElses = await completeResponse(
      admin,
      responseId,
      1,
      "q_file",
      { ...base, q_file: await upload(other.responseId) },
      crypto.randomUUID(),
    );
    expect(someoneElses.ok).toBe(false);

    const genuine = await completeResponse(
      admin,
      responseId,
      1,
      "q_file",
      { ...base, q_file: await upload(responseId) },
      crypto.randomUUID(),
    );
    expect(genuine.ok).toBe(true);
  });
});
