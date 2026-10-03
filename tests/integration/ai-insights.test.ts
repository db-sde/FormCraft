import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { completeResponse, startResponse } from "@/domains/responses";
import { getWorkspacePlan } from "@/domains/billing";

vi.mock("server-only", () => ({}));

/** AI analysis, summaries and follow-ups (Phase 3, Wave B) against the
 * real database and a stand-in model: credits are spent per call and
 * stop the work when they run out, results are stored beside responses
 * and hidden from members who can't see responses, and follow-ups are
 * only asked where the served version allows. */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const runId = crypto.randomUUID().slice(0, 8);
const password = `Pw-${crypto.randomUUID()}`;
const schema = {
  schemaVersion: 1,
  meta: { title: "Feedback" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "why",
      type: "long_text",
      order: 0,
      label: "What went wrong?",
      required: true,
      settings: { aiFollowUp: true },
    },
    { id: "more", type: "long_text", order: 1, label: "Anything else?", settings: {} },
  ],
  logic: [],
} as unknown as Json;

let server: Server;
let requests = 0;
let replies: string[] = [];
const env = { ...process.env };
let owner: { id: string; client: SupabaseClient<Database> };
let hidden: { id: string; client: SupabaseClient<Database> };
let workspaceId: string;
let formId: string;
const responseIds: string[] = [];

async function signIn(label: string) {
  const email = `ai-${label}-${runId}@example.com`;
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

const setCredits = (n: number) =>
  admin
    .from("workspaces")
    .update({ entitlement_overrides: { ai_credits_per_month: n } })
    .eq("id", workspaceId);
const creditsUsed = async () =>
  Number(
    (
      await admin
        .from("usage_counters")
        .select("value")
        .eq("workspace_id", workspaceId)
        .eq("metric", "ai_credits")
        .maybeSingle()
    ).data?.value ?? 0,
  );

beforeAll(async () => {
  server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      requests += 1;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: `msg_${requests}`,
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [{ type: "text", text: replies.shift() ?? "{}" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_API_KEY = "test-key";

  owner = await signIn("owner");
  hidden = await signIn("hidden");
  const { data: ws } = await owner.client.rpc("create_workspace_with_owner", {
    workspace_name: "AI",
    workspace_slug: `ai-${runId}`,
  });
  workspaceId = ws!.id;
  await admin.from("workspace_members").insert({
    workspace_id: workspaceId,
    user_id: hidden.id,
    role: "editor",
    permissions: { view_responses: false },
  });
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Feedback",
      slug: `ai-${runId}`,
      created_by: owner.id,
    })
    .select("id")
    .single();
  formId = form!.id;
  await admin
    .from("form_versions")
    .insert({ form_id: formId, status: "draft", version_number: 1, schema });
  const { error } = await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: schema,
  });
  if (error) throw error;
  for (const text of ["Exports are broken.", "Love it, thanks!", "Too slow on mobile."]) {
    const { responseId } = await startResponse(admin, formId);
    await completeResponse(
      admin,
      responseId,
      1,
      "more",
      { why: text },
      crypto.randomUUID(),
    );
    responseIds.push(responseId);
  }
});

afterAll(async () => {
  process.env = env;
  await new Promise((resolve) => server.close(resolve));
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  for (const p of [owner, hidden]) if (p) await admin.auth.admin.deleteUser(p.id);
});

beforeEach(() => {
  requests = 0;
  replies = [];
});

const analysis = (sentiment: string, tags: string[]) =>
  JSON.stringify({ sentiment, tags, leadScore: null, leadReason: null });

describe("response analysis", () => {
  it("spends a credit per response and stops when they run out", async () => {
    const { analyzeResponses, insightsFor, insightTotals, unanalyzedResponseIds } =
      await import("@/domains/responses/ai-insights");
    await setCredits(2);
    const { entitlements } = await getWorkspacePlan(admin, workspaceId);
    replies = [analysis("negative", ["exports"]), analysis("positive", ["praise"])];

    const result = await analyzeResponses(admin, {
      formId,
      workspaceId,
      responseIds,
      entitlements,
    });
    expect(result).toEqual({ analyzed: 2, outOfCredits: true, failed: 0 });
    expect(requests).toBe(2);
    expect(await creditsUsed()).toBe(2);
    expect(await unanalyzedResponseIds(admin, formId)).toHaveLength(1);

    const totals = await insightTotals(owner.client, formId);
    expect(totals.analyzed).toBe(2);
    expect(totals.sentiment).toMatchObject({ positive: 1, negative: 1 });
    expect(totals.topTags.map((t) => t.tag).sort()).toEqual(["exports", "praise"]);

    // Someone who can't see responses can't see what was read from them.
    expect((await insightsFor(owner.client, responseIds)).size).toBe(2);
    expect((await insightsFor(hidden.client, responseIds)).size).toBe(0);
    // And nobody but the server writes it.
    const forged = await owner.client
      .from("response_insights")
      .update({ sentiment: "positive" })
      .eq("form_id", formId)
      .select("response_id");
    expect(forged.data ?? []).toEqual([]);
  });

  it("stores a summary with only real quotes", async () => {
    const { generateFormSummary, getFormSummary } =
      await import("@/domains/responses/ai-insights");
    const input = { formId, workspaceId, userId: owner.id };
    const before = await getWorkspacePlan(admin, workspaceId);
    expect(
      await generateFormSummary(admin, { ...input, entitlements: before.entitlements }),
    ).toBe("out_of_credits");
    expect(requests).toBe(0);

    await setCredits(50);
    const { entitlements } = await getWorkspacePlan(admin, workspaceId);
    replies = [
      JSON.stringify({
        overview: "Mixed feedback.",
        themes: [
          {
            title: "Speed",
            description: "Slow on phones.",
            quotes: ["Too slow on mobile.", "It crashes daily"],
          },
        ],
      }),
    ];
    expect(await generateFormSummary(admin, { ...input, entitlements })).toBe("ok");
    const stored = await getFormSummary(owner.client, formId);
    expect(stored?.responseCount).toBe(3);
    expect(stored?.summary.themes[0].quotes).toEqual(["Too slow on mobile."]);
    expect(await getFormSummary(hidden.client, formId)).toBeNull();
  });
});

describe("follow-ups", () => {
  it("are asked once, only where the served version allows, and take one reply", async () => {
    const { askFollowUp, replyToFollowUp } =
      await import("@/domains/responses/follow-ups");
    const { responseId } = await startResponse(admin, formId);
    const used = await creditsUsed();

    // Not switched on for this question: no call, no credit.
    expect(await askFollowUp(admin, responseId, "more", "Some text here")).toBeNull();
    expect(await askFollowUp(admin, responseId, "nope", "Some text here")).toBeNull();
    expect(requests).toBe(0);

    replies = [JSON.stringify({ ask: true, question: "Which export failed?" })];
    expect(await askFollowUp(admin, responseId, "why", "Exports are broken.")).toBe(
      "Which export failed?",
    );
    // Asking again (a refresh) returns the same question for free.
    expect(await askFollowUp(admin, responseId, "why", "Exports are broken.")).toBe(
      "Which export failed?",
    );
    expect(requests).toBe(1);
    expect(await creditsUsed()).toBe(used + 1);

    expect(await replyToFollowUp(admin, responseId, "more", "x")).toBe(false);
    expect(await replyToFollowUp(admin, responseId, "why", "The CSV one")).toBe(true);

    await completeResponse(
      admin,
      responseId,
      1,
      "more",
      { why: "Exports are broken." },
      crypto.randomUUID(),
    );
    // Submitted: the reply is final, and nothing new is asked.
    expect(await replyToFollowUp(admin, responseId, "why", "Changed my mind")).toBe(
      false,
    );
    expect(await askFollowUp(admin, responseId, "why", "Exports are broken.")).toBeNull();
    const { data } = await owner.client
      .from("response_followups")
      .select("prompt, answer")
      .eq("response_id", responseId);
    expect(data).toEqual([{ prompt: "Which export failed?", answer: "The CSV one" }]);
    expect(
      (
        await hidden.client
          .from("response_followups")
          .select("id")
          .eq("response_id", responseId)
      ).data,
    ).toEqual([]);
  });
});
