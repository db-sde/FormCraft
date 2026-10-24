import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
} from "./helpers";

/**
 * QA FC-01 / FC-02: every load of the public form is a view (sent by the
 * page itself), and answers given just before the respondent leaves are
 * still saved.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Views and exits" },
  theme: {
    primaryColor: "#4f46e5",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks!", isDefault: true }],
  questions: [
    {
      id: "q_name",
      type: "short_text",
      order: 0,
      label: "Your name",
      required: true,
      settings: {},
    },
    {
      id: "q_email",
      type: "email",
      order: 1,
      label: "Your email",
      required: true,
      settings: {},
    },
    {
      id: "q_last",
      type: "long_text",
      order: 2,
      label: "Anything else?",
      required: false,
      settings: {},
    },
  ],
  logic: [],
};

// Headless Chrome announces itself in its user agent, which the server
// (rightly) treats as a bot. Respondents here are ordinary browsers.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

async function viewCount(formId: string) {
  const { count } = await adminClient()
    .from("analytics_events")
    .select("id", { count: "exact", head: true })
    .eq("form_id", formId)
    .eq("event_type", "form_viewed");
  return count ?? 0;
}

test("each page load counts as one view; bots don't, and starts never outrun views", async ({
  browser,
  request,
}) => {
  const user = await createConfirmedUser("e2e-views");
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    const context = await browser.newContext({ userAgent: BROWSER_UA });
    for (let i = 0; i < 3; i += 1) {
      const page = await context.newPage();
      await page.goto(liveLink);
      await expect(page.getByText("Your name")).toBeVisible();
      if (i === 0) {
        // One of the three visitors starts the form.
        await page.getByRole("textbox").fill("Ada");
        await expect
          .poll(async () => {
            const { count } = await adminClient()
              .from("responses")
              .select("id", { count: "exact", head: true })
              .eq("form_id", formId);
            return count;
          })
          .toBe(1);
      }
      await page.close();
    }
    await context.close();
    await expect.poll(() => viewCount(formId), { timeout: 10000 }).toBe(3);

    const bot = await request.post("/api/responses/view", {
      headers: { "user-agent": "curl/8.0" },
      data: { formId },
    });
    expect(bot.status()).toBe(204);
    // Give a (wrongly) recorded bot view time to land before checking.
    await new Promise((r) => setTimeout(r, 1500));
    expect(await viewCount(formId)).toBe(3);
  } finally {
    await deleteUser(user.userId);
  }
});

test("an answer typed just before leaving is still saved", async ({ browser }) => {
  const user = await createConfirmedUser("e2e-exit-save");
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    const context = await browser.newContext({ userAgent: BROWSER_UA });
    const page = await context.newPage();
    await page.goto(liveLink);
    const saved = async () => {
      const { data } = await adminClient()
        .from("answers")
        .select("question_id, value, responses!inner(form_id)")
        .eq("responses.form_id", formId);
      return Object.fromEntries((data ?? []).map((a) => [a.question_id, a.value]));
    };
    await page.getByRole("textbox").fill("Grace");
    await page.keyboard.press("Enter");
    // Moving on saves straight away (no autosave pause).
    await expect.poll(saved, { timeout: 5000 }).toEqual({ q_name: "Grace" });
    await page.getByRole("textbox").fill("grace@example.com");
    // Leave at once: no Enter, well inside the autosave pause.
    await page.close({ runBeforeUnload: true });
    await context.close();

    await expect
      .poll(saved, { timeout: 10000 })
      .toEqual({ q_name: "Grace", q_email: "grace@example.com" });
  } finally {
    await deleteUser(user.userId);
  }
});
