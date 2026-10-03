import { createServer, type Server } from "node:http";
import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { FAKE_AI_PORT } from "../../playwright.config";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/**
 * The AI features (Phase 3, Wave B) in the browser, against a stand-in
 * Messages API (ANTHROPIC_BASE_URL points here, see playwright.config.ts):
 * a respondent gets one follow-up question; the creator analyzes and
 * summarizes responses and applies a copilot rewording. No real model.
 */
let server: Server;
const seen: string[] = [];

function replyFor(system: string): unknown {
  if (system.includes("just answered an open question"))
    return { ask: true, question: "Which export were you using?" };
  if (system.includes("read one response"))
    return {
      sentiment: "negative",
      tags: ["exports"],
      leadScore: null,
      leadReason: null,
    };
  if (system.includes("summarize responses"))
    return {
      overview: "Respondents report broken exports.",
      themes: [
        {
          title: "Exports",
          description: "The export button fails.",
          quotes: ["The export button did nothing", "Made-up quote"],
        },
      ],
    };
  return {
    suggestions: [
      {
        questionNumber: 1,
        kind: "rewrite",
        message: "Friendlier wording gets longer answers.",
        newLabel: "What happened, in your own words?",
      },
    ],
  };
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw) as { system: string };
      seen.push(body.system);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: `msg_${seen.length}`,
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [{ type: "text", text: JSON.stringify(replyFor(body.system)) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(FAKE_AI_PORT, "127.0.0.1", resolve));
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Feedback" },
  theme: {
    primaryColor: "#1f1f1f",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks!", isDefault: true }],
  questions: [
    {
      id: "why",
      type: "long_text",
      order: 0,
      label: "What went wrong?",
      required: true,
      settings: { aiFollowUp: true },
    },
  ],
  logic: [],
};

test("a follow-up for the respondent; analysis, summary and review for the creator", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const user = await createConfirmedUser("e2e-ai");
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);

    // Respondent: one optional follow-up about what they wrote.
    await page.goto(liveLink);
    await page.getByLabel("What went wrong?").fill("The export button did nothing.");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Which export were you using?")).toBeVisible();
    await page.getByLabel(/Which export were you using\?/).fill("The CSV one");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("heading", { name: "Thanks!" })).toBeVisible();
    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from("response_followups")
          .select("prompt, answer, responses!inner(form_id, status)")
          .eq("responses.form_id", formId)
          .maybeSingle();
        return data && [data.prompt, data.answer];
      })
      .toEqual(["Which export were you using?", "The CSV one"]);

    // Creator: analyze and summarize on the Summary tab.
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}/responses?tab=summary`);
    await page.getByRole("button", { name: "Analyze new responses" }).click();
    await expect(page.getByText("Sentiment · 1 analyzed")).toBeVisible();
    await expect(page.getByText("exports 1")).toBeVisible();
    await page.getByRole("button", { name: "Summarize responses" }).click();
    await expect(page.getByText("Respondents report broken exports.")).toBeVisible();
    await expect(page.getByText("“The export button did nothing”")).toBeVisible();
    await expect(page.getByText("Made-up quote")).toHaveCount(0);

    // The response shows the follow-up and its analysis.
    const { data: response } = await adminClient()
      .from("responses")
      .select("id")
      .eq("form_id", formId)
      .single();
    await page.goto(`/forms/${formId}/responses/${response!.id}`);
    await expect(page.getByText("Follow-up (written by AI): Which export")).toBeVisible();
    await expect(page.getByText("The CSV one")).toBeVisible();
    await expect(page.getByText("Negative")).toBeVisible();

    // Copilot: a suggested rewording is applied only when asked.
    await page.goto(`/forms/${formId}`);
    await page.getByRole("button", { name: /^Logic/ }).click();
    await page.getByRole("tab", { name: /Check/ }).click();
    await page.getByRole("button", { name: "Review my form" }).click();
    await expect(page.getByText("Friendlier wording gets longer answers.")).toBeVisible();
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("Applied")).toBeVisible();
    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from("form_versions")
          .select("schema")
          .eq("form_id", formId)
          .eq("status", "draft")
          .single();
        return (data?.schema as unknown as FormSchemaV1).questions[0].label;
      })
      .toBe("What happened, in your own words?");

    // One model call each: follow-up, analysis, summary, review.
    expect(seen.length).toBe(4);
  } finally {
    await deleteUser(user.userId);
  }
});
