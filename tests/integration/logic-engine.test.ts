import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { startResponse, completeResponse, getResponseSummary } from "@/domains/responses";
import { parseFormSchema } from "@/domains/forms/schema";

/**
 * The logic engine end to end on the server: hidden fields captured at
 * start, then completion deciding the path, the ending and the checks —
 * the same walk the respondent's browser ran, with the server's inputs.
 */

function admin(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env not set for integration tests");
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

const schema = parseFormSchema({
  schemaVersion: 1,
  meta: { title: "Eligibility" },
  theme: {},
  hiddenFields: [{ name: "plan", default: "free" }],
  variables: [{ id: "points", name: "points", type: "number" }],
  endings: [
    { id: "end_default", title: "Thanks", isDefault: true },
    { id: "end_pro", title: "Pro welcome, [points] points" },
    { id: "end_no", title: "Not eligible" },
  ],
  questions: [
    {
      id: "q_age",
      type: "number",
      order: 0,
      label: "Age",
      required: true,
      settings: {},
    },
    {
      id: "q_school",
      type: "short_text",
      order: 1,
      label: "School",
      required: true,
      settings: {},
      // Only for under-18s; otherwise skipped and never required.
      visibleIf: {
        type: "compare",
        left: { type: "answer", questionId: "q_age" },
        op: "lt",
        right: { type: "literal", value: 18 },
      },
    },
    {
      id: "q_email",
      type: "short_text",
      order: 2,
      label: "Email",
      required: true,
      settings: {},
    },
    {
      id: "q_confirm",
      type: "short_text",
      order: 3,
      label: "Confirm email",
      required: true,
      settings: {},
      validations: [
        {
          id: "same",
          check: {
            type: "compare",
            left: { type: "answer", questionId: "q_confirm" },
            op: "eq",
            right: { type: "answer", questionId: "q_email" },
          },
          message: "The emails don't match.",
        },
      ],
    },
  ],
  logic: [],
  rules: [
    {
      id: "r_points",
      on: { event: "question_answered", questionId: "q_age" },
      then: [
        {
          type: "set_variable",
          variableId: "points",
          op: "set",
          value: {
            type: "binary",
            op: "*",
            left: { type: "answer", questionId: "q_age" },
            right: { type: "literal", value: 2 },
          },
        },
      ],
    },
    {
      id: "r_minor",
      on: { event: "form_completed" },
      when: {
        type: "compare",
        left: { type: "answer", questionId: "q_age" },
        op: "lt",
        right: { type: "literal", value: 13 },
      },
      then: [{ type: "jump_to_ending", endingId: "end_no" }],
    },
    {
      id: "r_pro",
      on: { event: "form_completed" },
      when: {
        type: "compare",
        left: { type: "hidden", name: "plan" },
        op: "eq",
        right: { type: "literal", value: "pro" },
      },
      then: [{ type: "jump_to_ending", endingId: "end_pro" }],
    },
  ],
});

describe("logic engine on the server (integration)", () => {
  const supabase = admin();
  let userId: string;
  let workspaceId: string;
  let formId: string;
  const runId = crypto.randomUUID().slice(0, 8);

  beforeAll(async () => {
    const { data: user, error } = await supabase.auth.admin.createUser({
      email: `logic-engine-${runId}@example.com`,
      password: crypto.randomUUID(),
      email_confirm: true,
    });
    if (error) throw error;
    userId = user.user.id;
    const { data: workspace } = await supabase
      .from("workspaces")
      .insert({ name: "Logic", slug: `logic-${runId}`, owner_id: userId })
      .select("id")
      .single();
    workspaceId = workspace!.id;
    await supabase
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: userId, role: "owner" });
    const { data: form } = await supabase
      .from("forms")
      .insert({
        workspace_id: workspaceId,
        title: "Logic",
        slug: `logic-${runId}`,
        created_by: userId,
      })
      .select("id")
      .single();
    formId = form!.id;
    await supabase.from("form_versions").insert({
      form_id: formId,
      status: "draft",
      version_number: 1,
      schema: schema as unknown as Json,
    });
    const { error: publishError } = await supabase.rpc("publish_form_version", {
      target_form_id: formId,
      compiled_schema: schema as unknown as Json,
    });
    if (publishError) throw publishError;
  });

  afterAll(async () => {
    if (workspaceId) await supabase.from("workspaces").delete().eq("id", workspaceId);
    if (userId) await supabase.auth.admin.deleteUser(userId);
  });

  async function submit(
    answers: Record<string, unknown>,
    hidden?: Record<string, string>,
  ) {
    const started = await startResponse(supabase, formId, { hidden });
    return {
      id: started.responseId,
      result: await completeResponse(
        supabase,
        started.responseId,
        1,
        "q_confirm",
        answers,
        crypto.randomUUID(),
      ),
    };
  }

  it("keeps only declared hidden fields, and routes by them", async () => {
    const { id, result } = await submit(
      { q_age: 30, q_email: "a@b.co", q_confirm: "a@b.co" },
      { plan: "pro", evil: "x" },
    );
    expect(result).toMatchObject({ ok: true, endingId: "end_pro" });
    const { data } = await supabase
      .from("responses")
      .select("hidden_fields")
      .eq("id", id)
      .single();
    expect(data?.hidden_fields).toEqual({ plan: "pro" });
  });

  it("uses the hidden field's default when the link has none", async () => {
    const { result } = await submit({
      q_age: 30,
      q_email: "a@b.co",
      q_confirm: "a@b.co",
    });
    expect(result).toMatchObject({ ok: true, endingId: "end_default" });
  });

  it("doesn't require a question that was hidden, and doesn't store its answer", async () => {
    const { id, result } = await submit({
      q_age: 30,
      q_school: "left over from a branch",
      q_email: "a@b.co",
      q_confirm: "a@b.co",
    });
    expect(result.ok).toBe(true);
    const { data: answers } = await supabase
      .from("answers")
      .select("question_id")
      .eq("response_id", id);
    expect(answers?.map((a) => a.question_id).sort()).toEqual([
      "q_age",
      "q_confirm",
      "q_email",
    ]);
  });

  it("requires a question when its condition shows it", async () => {
    const { result } = await submit({
      q_age: 15,
      q_email: "a@b.co",
      q_confirm: "a@b.co",
    });
    expect(result).toMatchObject({ ok: false, missingQuestionIds: ["q_school"] });
  });

  it("enforces cross-field checks on the server", async () => {
    const { result } = await submit({
      q_age: 30,
      q_email: "a@b.co",
      q_confirm: "x@y.co",
    });
    expect(result).toMatchObject({
      ok: false,
      errors: [{ questionId: "q_confirm", message: "The emails don't match." }],
    });
  });

  it("picks the ending from completion rules", async () => {
    const { result } = await submit({
      q_age: 12,
      q_school: "Elm",
      q_email: "a@b.co",
      q_confirm: "a@b.co",
    });
    expect(result).toMatchObject({ ok: true, endingId: "end_no" });
  });

  // Runs last: summarises the responses the tests above completed.
  it("summarises endings reached and variables across completed responses", async () => {
    const summary = await getResponseSummary(supabase, formId, {});
    expect(summary.total).toBe(4);
    expect(summary.outcomes.endings).toEqual([
      { endingId: "end_default", title: "Thanks", count: 2, percent: 50 },
      {
        endingId: "end_pro",
        title: "Pro welcome, [points] points",
        count: 1,
        percent: 25,
      },
      { endingId: "end_no", title: "Not eligible", count: 1, percent: 25 },
    ]);
    // points = age × 2, replayed per response: 60, 60, 60 and 24.
    expect(summary.outcomes.variables).toEqual([
      {
        variableId: "points",
        name: "points",
        kind: "number",
        count: 4,
        average: 51,
        min: 24,
        max: 60,
      },
    ]);

    const filtered = await getResponseSummary(supabase, formId, { endingId: "end_no" });
    expect(filtered.outcomes.variables[0]).toMatchObject({ count: 1, average: 24 });
  });
});
