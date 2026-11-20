import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { parseFormSchema } from "@/domains/forms/schema";
import { correctAnswer, listRevisions } from "@/domains/responses/corrections";

/**
 * Corrections to submitted answers (roadmap #55, migration 67) against
 * the real database: the original is kept, evidence can't be rewritten,
 * unfinished responses can't be corrected, and only owners and admins
 * may correct by default.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin: SupabaseClient<Database> = createClient<Database>(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
const rawSchema = {
  schemaVersion: 1,
  meta: { title: "Corrections" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "email",
      type: "email",
      order: 0,
      label: "Email",
      required: true,
      settings: {},
    },
    {
      id: "plan",
      type: "single_select",
      order: 1,
      label: "Plan",
      required: false,
      settings: {
        options: [
          { id: "basic", label: "Basic" },
          { id: "pro", label: "Pro" },
        ],
      },
    },
    {
      id: "sig",
      type: "signature",
      order: 2,
      label: "Sign",
      required: false,
      settings: {},
    },
  ],
  logic: [],
};
const schema = parseFormSchema(rawSchema);
const question = (id: string) => schema.questions.find((q) => q.id === id)!;

let ownerId: string;
let editor: { id: string; client: SupabaseClient<Database> };
let workspaceId: string;
let formId: string;
let versionId: string;

async function user(prefix: string) {
  const email = `${prefix}-${runId}@example.com`;
  const password = `Pw-${crypto.randomUUID()}`;
  const { data } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  const client = createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  await client.auth.signInWithPassword({ email, password });
  return { id: data.user!.id, client };
}

async function response(status: "completed" | "partial") {
  const { data } = await admin
    .from("responses")
    .insert({
      form_id: formId,
      form_version_id: versionId,
      status,
      completed_at: status === "completed" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  await admin.from("answers").insert([
    { response_id: data!.id, question_id: "email", value: "ada@exmaple.com" },
    { response_id: data!.id, question_id: "sig", value: { signed: true } as Json },
  ]);
  return data!.id;
}

beforeAll(async () => {
  ownerId = (await user("corr-owner")).id;
  editor = await user("corr-editor");
  const { data: ws } = await admin
    .from("workspaces")
    .insert({ name: "Corrections", slug: `corr-${runId}`, owner_id: ownerId })
    .select("id")
    .single();
  workspaceId = ws!.id;
  await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: editor.id, role: "editor" });
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Corrections",
      slug: `corr-${runId}`,
      created_by: ownerId,
    })
    .select("id")
    .single();
  formId = form!.id;
  await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: rawSchema as unknown as Json,
  });
  versionId = (
    await admin
      .from("form_versions")
      .select("id")
      .eq("form_id", formId)
      .eq("status", "published")
      .single()
  ).data!.id;
}, 60_000);

afterAll(async () => {
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  for (const id of [ownerId, editor?.id]) if (id) await admin.auth.admin.deleteUser(id);
});

describe("correcting a submitted answer (#55)", () => {
  it("replaces the answer and keeps the original, the reason and a timeline entry", async () => {
    const responseId = await response("completed");
    const first = await correctAnswer(admin, {
      responseId,
      question: question("email"),
      value: "ada@example.com",
      reason: "Respondent emailed about a typo",
      actorId: ownerId,
    });
    expect(first.ok).toBe(true);
    const second = await correctAnswer(admin, {
      responseId,
      question: question("plan"),
      value: "pro",
      reason: "Upgraded by phone",
      actorId: ownerId,
    });
    expect(second.ok).toBe(true);

    const { data: answers } = await admin
      .from("answers")
      .select("question_id, value")
      .eq("response_id", responseId)
      .order("question_id");
    expect(answers).toEqual([
      { question_id: "email", value: "ada@example.com" },
      { question_id: "plan", value: "pro" },
      { question_id: "sig", value: { signed: true } },
    ]);
    const revisions = await listRevisions(admin, responseId);
    expect(
      revisions.map((r) => [r.questionId, r.previousValue, r.newValue, r.reason]),
    ).toEqual([
      ["email", "ada@exmaple.com", "ada@example.com", "Respondent emailed about a typo"],
      ["plan", null, "pro", "Upgraded by phone"],
    ]);
    const { data: events } = await admin
      .from("response_events")
      .select("kind, actor_id")
      .eq("response_id", responseId);
    expect(events).toEqual([
      { kind: "answer_edited", actor_id: ownerId },
      { kind: "answer_edited", actor_id: ownerId },
    ]);
  });

  it("refuses evidence, unfinished responses, no reason, invalid and unchanged values", async () => {
    const responseId = await response("completed");
    const attempt = (id: string, value: unknown, reason = "A good reason") =>
      correctAnswer(admin, {
        responseId,
        question: question(id),
        value,
        reason,
        actorId: ownerId,
      });

    expect(await attempt("sig", { signed: false })).toMatchObject({ ok: false });
    expect(await attempt("email", "not an email")).toMatchObject({ ok: false });
    expect(await attempt("email", "")).toMatchObject({ ok: false }); // required
    expect(await attempt("email", "x@example.com", "  ")).toMatchObject({ ok: false });
    expect(await attempt("email", "ada@exmaple.com")).toEqual({
      ok: false,
      message: "That's the answer already saved.",
    });
    const partial = await response("partial");
    expect(
      await correctAnswer(admin, {
        responseId: partial,
        question: question("email"),
        value: "x@example.com",
        reason: "A good reason",
        actorId: ownerId,
      }),
    ).toEqual({ ok: false, message: "Only submitted responses can be corrected." });

    // Straight to the database, around the server's checks: still refused.
    const { error } = await admin.rpc("correct_submitted_answer", {
      p_response_id: responseId,
      p_question_id: "sig",
      p_value: { signed: false } as Json,
      p_reason: "Trying it directly",
      p_actor: ownerId,
    });
    expect(error?.message).toContain("not_editable");
    expect(await listRevisions(admin, responseId)).toEqual([]);
  });

  it("is off for editors unless given, and members can't call the function themselves", async () => {
    const may = async () =>
      (
        await editor.client.rpc("has_permission", {
          target_workspace_id: workspaceId,
          permission: "edit_responses",
        })
      ).data;
    expect(await may()).toBe(false);
    await admin
      .from("workspace_members")
      .update({ permissions: { edit_responses: true } })
      .eq("workspace_id", workspaceId)
      .eq("user_id", editor.id);
    expect(await may()).toBe(true);

    const responseId = await response("completed");
    const { error } = await editor.client.rpc("correct_submitted_answer", {
      p_response_id: responseId,
      p_question_id: "email",
      p_value: "x@example.com",
      p_reason: "Trying it directly",
      p_actor: editor.id,
    });
    expect(error).not.toBeNull();
  });
});
