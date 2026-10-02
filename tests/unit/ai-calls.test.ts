// @vitest-environment node
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFormSchema } from "@/domains/forms/schema";

vi.mock("server-only", () => ({}));

/**
 * The AI calls against a stand-in Messages API (the SDK honours
 * ANTHROPIC_BASE_URL): what we send — model, structured-output schema,
 * fallbacks — and what we do with each kind of reply. No real model.
 */
type Captured = { headers: IncomingHttpHeaders; body: Record<string, unknown> };
let server: Server;
let requests: Captured[] = [];
let replies: { text?: string; stop_reason?: string }[] = [];

const env = { ...process.env };

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      requests.push({ headers: req.headers, body: JSON.parse(raw) });
      const reply = replies.shift() ?? { text: "{}" };
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: `msg_${requests.length}`,
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: reply.text === undefined ? [] : [{ type: "text", text: reply.text }],
          stop_reason: reply.stop_reason ?? "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_API_KEY = "test-key";
});

afterAll(async () => {
  process.env = env;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  requests = [];
  replies = [];
});

const schema = parseFormSchema({
  schemaVersion: 1,
  meta: { title: "Signup" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "role",
      type: "single_select",
      order: 0,
      label: "Role",
      settings: {
        options: [
          { id: "o_student", label: "Student" },
          { id: "o_pro", label: "Pro" },
        ],
      },
    },
    { id: "q2", type: "short_text", order: 1, label: "Name", settings: {} },
    { id: "q3", type: "short_text", order: 2, label: "Notes", settings: {} },
  ],
  logic: [],
});

const ruleDraft = (value: string) =>
  JSON.stringify({
    possible: true,
    reason: "",
    name: "Students skip",
    trigger: { event: "question_answered", questionNumber: 1 },
    match: "all",
    conditions: [
      { left: "q1", op: "eq", value, values: [], value2: null, valueIsFormula: false },
    ],
    actions: [
      {
        type: "jump_to_question",
        questionNumber: 3,
        endingId: null,
        variable: null,
        op: null,
        formula: null,
        candidates: [],
      },
    ],
    newVariables: [],
  });

describe("proposeRule", () => {
  it("asks with the form described and a constrained schema, and translates the reply", async () => {
    const { proposeRule } = await import("@/domains/ai/propose-rule");
    replies = [{ text: ruleDraft("Student") }];
    const result = await proposeRule("Students skip to the notes", schema);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.rule.then).toEqual([
        { type: "jump_to_question", questionId: "q3" },
      ]);
    }
    const [{ headers, body }] = requests;
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(body).toMatchObject({
      model: "claude-opus-5-5",
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema" } },
    });
    expect(JSON.stringify(body.output_config)).toContain('"enum":["all","any"]');
    const prompt = (body.messages as { content: string }[])[0].content;
    expect(prompt).toContain("q1 [single_select] Role");
    expect(prompt).toContain("Students skip to the notes");
  });

  it("gives the model one chance to fix a draft that doesn't fit", async () => {
    const { proposeRule } = await import("@/domains/ai/propose-rule");
    replies = [{ text: ruleDraft("Teacher") }, { text: ruleDraft("Student") }];
    const result = await proposeRule("Students skip", schema);

    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(2);
    const retry = requests[1].body.messages as { role: string; content: unknown }[];
    expect(retry.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(retry[2].content).toContain("“Teacher” isn't an option of “Role”.");
  });

  it("reports the problem when the fix fails too, and handles refusals and garbage", async () => {
    const { proposeRule } = await import("@/domains/ai/propose-rule");
    replies = [{ text: ruleDraft("Teacher") }, { text: ruleDraft("Teacher") }];
    expect(await proposeRule("x", schema)).toEqual({
      ok: false,
      message: "“Teacher” isn't an option of “Role”.",
    });

    replies = [{ stop_reason: "refusal" }];
    expect(await proposeRule("x", schema)).toMatchObject({ ok: false });

    replies = [{ text: "not json" }];
    expect(await proposeRule("x", schema)).toMatchObject({ ok: false });
  });
});

describe("generateForm", () => {
  it("builds the form from the reply", async () => {
    const { generateForm } = await import("@/domains/ai/generate-form");
    replies = [
      {
        text: JSON.stringify({
          possible: true,
          reason: "",
          title: "Feedback",
          intro: "Quick one.",
          questions: [
            {
              type: "rating",
              label: "How was it?",
              description: "",
              required: true,
              options: [],
              scale: 5,
            },
          ],
          variables: [],
          endings: [{ title: "Thanks!", description: "", isDefault: true }],
          rules: [],
        }),
      },
    ];
    const result = await generateForm("A one-question feedback form");
    expect(result.ok && result.schema.questions.map((q) => q.type)).toEqual([
      "welcome_screen",
      "rating",
    ]);
    expect(requests[0].body).toMatchObject({
      model: "claude-opus-5-5",
      fallbacks: "default",
    });
  });

  it("says when the form came out too big", async () => {
    const { generateForm } = await import("@/domains/ai/generate-form");
    replies = [{ text: '{"possible": tr', stop_reason: "max_tokens" }];
    expect(await generateForm("huge")).toMatchObject({
      ok: false,
      message: expect.stringContaining("too big"),
    });
  });
});
