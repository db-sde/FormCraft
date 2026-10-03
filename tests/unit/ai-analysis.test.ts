// @vitest-environment node
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFormSchema } from "@/domains/forms/schema";

vi.mock("server-only", () => ({}));

/**
 * AI over responses (Phase 3, Wave B) against a stand-in Messages API:
 * what's sent (and what's left out), and how each reply is checked
 * before anything is kept. No real model.
 */
let server: Server;
let requests: Record<string, unknown>[] = [];
let replies: { text?: string; stop_reason?: string }[] = [];
const env = { ...process.env };

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      requests.push(JSON.parse(raw));
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
  meta: { title: "Feedback" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "c",
      type: "contact_info",
      order: 0,
      label: "You",
      settings: { fields: ["name", "email", "company"], requiredFields: [] },
    },
    { id: "mail", type: "email", order: 1, label: "Work email", settings: {} },
    { id: "why", type: "long_text", order: 2, label: "What went wrong?", settings: {} },
    {
      id: "file",
      type: "file_upload",
      order: 3,
      label: "Screenshot",
      settings: { acceptedMimeTypes: ["image/png"] },
    },
  ],
  logic: [],
});
const answers = {
  c: { name: "Ada Lovelace", email: "ada@example.com", company: "Analytical Engines" },
  mail: "ada@work.example",
  why: "The export button did nothing and support never replied.",
  file: "upload-123",
};
const prompt = () => (requests.at(-1)!.messages as { content: string }[])[0].content;

describe("what the model is shown", () => {
  it("leaves out names, emails, phone numbers and files", async () => {
    const { describeResponseForAi } = await import("@/domains/ai/response-analysis");
    const text = describeResponseForAi(schema, answers, [
      { questionId: "why", prompt: "Which export?", answer: "CSV" },
    ]);
    expect(text).toBe(
      [
        "Q: You",
        "A: Company: Analytical Engines",
        "Q: What went wrong?",
        "A: The export button did nothing and support never replied.",
        "Q (follow-up): Which export?",
        "A: CSV",
      ].join("\n"),
    );
  });
});

describe("analyzeResponse", () => {
  it("normalises tags, and only scores leads when there are criteria", async () => {
    const { analyzeResponse } = await import("@/domains/ai/response-analysis");
    const reply = JSON.stringify({
      sentiment: "negative",
      tags: ["Export Bug!", "support", "export bug", "a", "b", "c", "d"],
      leadScore: 140,
      leadReason: "They run a company.",
    });
    replies = [{ text: reply }, { text: reply }];

    const plain = await analyzeResponse({
      schema,
      answers,
      leadCriteria: null,
      knownTags: ["billing"],
    });
    expect(plain).toEqual({
      sentiment: "negative",
      tags: ["export bug", "support", "a", "b", "c"],
      leadScore: null,
      leadReason: null,
    });
    expect(prompt()).toContain("Existing tags: billing");
    expect(prompt()).not.toContain("ada@");
    expect(requests[0]).toMatchObject({
      model: "claude-opus-5-5",
      output_config: { effort: "low", format: { type: "json_schema" } },
    });
    expect(JSON.stringify(requests[0].output_config)).toContain(
      '"enum":["positive","neutral","negative","mixed"]',
    );

    const scored = await analyzeResponse({
      schema,
      answers,
      leadCriteria: "Companies with a real problem",
      knownTags: [],
    });
    expect(scored).toMatchObject({ leadScore: 100, leadReason: "They run a company." });
  });

  it("returns nothing for a refusal or an empty response", async () => {
    const { analyzeResponse } = await import("@/domains/ai/response-analysis");
    replies = [{ stop_reason: "refusal" }];
    expect(
      await analyzeResponse({ schema, answers, leadCriteria: null, knownTags: [] }),
    ).toBeNull();
    // Nothing written: no request at all.
    requests = [];
    expect(
      await analyzeResponse({
        schema,
        answers: { mail: "x@y.co" },
        leadCriteria: null,
        knownTags: [],
      }),
    ).toBeNull();
    expect(requests).toHaveLength(0);
  });
});

describe("summarizeResponses", () => {
  it("keeps only quotes that are really in the responses", async () => {
    const { summarizeResponses } = await import("@/domains/ai/response-analysis");
    replies = [
      {
        text: JSON.stringify({
          overview: "People are unhappy with exports.",
          themes: [
            {
              title: "Exports",
              description: "The export button fails.",
              quotes: ["the export button did nothing", "I love this product"],
            },
          ],
        }),
      },
    ];
    const result = await summarizeResponses({
      schema,
      transcripts: [
        "Q: What went wrong?\nA: The export button did   nothing and support never replied.",
      ],
    });
    expect(result?.used).toBe(1);
    expect(result?.summary.themes[0].quotes).toEqual(["the export button did nothing"]);
    expect(prompt()).toContain('<response n="1">');
  });
});

describe("reviewForm", () => {
  it("maps suggestions to real questions and drops the rest", async () => {
    const { reviewForm } = await import("@/domains/ai/response-analysis");
    replies = [
      {
        text: JSON.stringify({
          suggestions: [
            {
              questionNumber: 3,
              kind: "rewrite",
              message: "Friendlier.",
              newLabel: "What happened?",
            },
            {
              questionNumber: 9,
              kind: "remove",
              message: "No such question.",
              newLabel: null,
            },
            {
              questionNumber: 2,
              kind: "rewrite",
              message: "No wording given.",
              newLabel: " ",
            },
            {
              questionNumber: null,
              kind: "general",
              message: "Short and clear.",
              newLabel: "x",
            },
          ],
        }),
      },
    ];
    const suggestions = await reviewForm({ schema, describedForm: "Form: Feedback" });
    expect(suggestions).toEqual([
      {
        questionId: "why",
        questionNumber: 3,
        kind: "rewrite",
        message: "Friendlier.",
        newLabel: "What happened?",
      },
      {
        questionId: null,
        questionNumber: null,
        kind: "general",
        message: "Short and clear.",
        newLabel: null,
      },
    ]);
  });
});

describe("followUpQuestion", () => {
  it("asks only when the model says so, and never for a blank answer", async () => {
    const { followUpQuestion } = await import("@/domains/ai/response-analysis");
    const input = { formTitle: "Feedback", questionLabel: "What went wrong?" };
    replies = [
      { text: JSON.stringify({ ask: true, question: "Which  export were you using?" }) },
      { text: JSON.stringify({ ask: false, question: "" }) },
      { text: JSON.stringify({ ask: true, question: "x".repeat(400) }) },
    ];
    expect(await followUpQuestion({ ...input, answer: "The export broke." })).toBe(
      "Which export were you using?",
    );
    expect(await followUpQuestion({ ...input, answer: "It was fine." })).toBeNull();
    expect(await followUpQuestion({ ...input, answer: "Something." })).toBeNull();
    expect(requests).toHaveLength(3);
    expect(await followUpQuestion({ ...input, answer: " " })).toBeNull();
    expect(requests).toHaveLength(3);
  });
});
