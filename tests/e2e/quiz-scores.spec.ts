import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { createConfirmedUser, createPublishedForm, deleteUser } from "./helpers";

/**
 * Quiz secrecy (QA FC15-45): a quiz that shows a running score but
 * doesn't branch on it sends no option points to the page; the score
 * shown part-way comes from the server.
 */
const schema = {
  schemaVersion: 1,
  meta: { title: "Capitals" },
  theme: {},
  variables: [{ id: "v_score", name: "score", type: "number" }],
  endings: [{ id: "end", title: "You scored {{score}}", isDefault: true }],
  questions: [
    {
      id: "q_capital",
      type: "single_select",
      order: 0,
      label: "Capital of France?",
      required: true,
      settings: {
        allowOther: false,
        options: [
          {
            id: "paris",
            label: "Paris",
            scores: [{ variableId: "v_score", points: 10 }],
          },
          { id: "london", label: "London" },
        ],
      },
    },
    {
      id: "q_so_far",
      type: "statement",
      order: 1,
      label: "So far: {{score}} points",
      required: false,
      settings: {},
    },
    {
      id: "q_more",
      type: "short_text",
      order: 2,
      label: "Any comments?",
      required: false,
      settings: {},
    },
  ],
  logic: [],
} as unknown as FormSchemaV1;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

test("no points in the page; the running score comes from the server", async ({
  browser,
  request,
}) => {
  const user = await createConfirmedUser("e2e-quiz-scores");
  try {
    const { liveLink } = await createPublishedForm(user, schema);
    const html = await (await request.get(liveLink)).text();
    expect(html).toContain("Capital of France?");
    expect(html).not.toMatch(/\\?"points\\?"/);
    expect(html).not.toMatch(/\\?"scores\\?"/);

    const context = await browser.newContext({ userAgent: BROWSER_UA });
    const page = await context.newPage();
    await page.goto(liveLink);
    await page.getByRole("radio", { name: /Paris/ }).click();
    await expect(page.getByText("So far: 10 points")).toBeVisible();

    // Another browser can't ask for this response's scores.
    const responseId = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i += 1) {
        const value = localStorage.getItem(localStorage.key(i)!) ?? "";
        const match = /"responseId":"([0-9a-f-]{36})"/.exec(value);
        if (match) return match[1];
      }
      return null;
    });
    expect(responseId).toBeTruthy();
    const stranger = await request.post(`/api/responses/${responseId}/scores`, {
      data: { answers: { q_capital: "paris" }, path: ["q_capital"] },
    });
    expect(stranger.status()).toBe(403);
    await context.close();
  } finally {
    await deleteUser(user.userId);
  }
});
