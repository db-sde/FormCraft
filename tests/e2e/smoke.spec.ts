import { test, expect, type Page } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";
import { PAGE_ROUTES } from "./routes";

/**
 * Renders every page in the app (see routes.ts) and fails on anything a
 * user would see as broken: an error screen, an uncaught exception, a
 * console error, or (on phones) content wider than the screen. Runs on
 * desktop and mobile projects. Cheap, broad, and the first thing to go
 * red when a change breaks a page you weren't looking at.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Smoke form" },
  theme: {
    primaryColor: "#4f46e5",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks!", isDefault: true }],
  questions: [
    {
      id: "q_contact",
      type: "contact_info",
      order: 0,
      label: "Where can we reach you?",
      required: true,
      settings: { fields: ["name", "email"], requiredFields: ["name", "email"] },
    },
    {
      id: "q_last",
      type: "long_text",
      order: 1,
      label: "Anything else?",
      required: false,
      settings: {},
    },
  ],
  logic: [],
};

function watchForBreakage(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`uncaught: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // Intentional 404 pages log their own failed document request.
    if (/Failed to load resource.*404/.test(text)) return;
    problems.push(`console: ${text}`);
  });
  return problems;
}

async function expectHealthy(page: Page, path: string, problems: string[]) {
  const response = await page.goto(path);
  expect(response?.status(), `${path} status`).toBeLessThan(400);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Something went wrong"), path).toHaveCount(0);
  await expect(page.getByText("Page not found"), path).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, `${path} is wider than the screen`).toBeLessThanOrEqual(1);
  expect(problems, path).toEqual([]);
}

test.describe("smoke: every page renders cleanly", () => {
  test.setTimeout(120_000);

  test("signed-out pages", async ({ page }) => {
    const problems = watchForBreakage(page);
    for (const path of [
      "/",
      "/login",
      "/login/sso",
      "/signup",
      "/signup/check-email",
      "/forgot-password",
      "/forgot-password/check-email",
      "/reset-password",
      "/two-factor",
    ]) {
      await expectHealthy(page, path, problems);
    }
  });

  test("signed-in pages and the public form", async ({ page, request, browser }) => {
    const user = await createConfirmedUser("e2e-smoke");
    try {
      const { formId, liveLink } = await createPublishedForm(user, schema);

      // One completed response so the detail page has something to show.
      const start = await request.post("/api/responses/start", { data: { formId } });
      const { responseId } = await start.json();
      const done = await request.post(`/api/responses/${responseId}/complete`, {
        data: {
          clientRevision: 1,
          lastQuestionId: "q_last",
          answers: { q_contact: { name: "Smoke", email: "smoke@example.com" } },
          idempotencyKey: crypto.randomUUID(),
        },
      });
      expect(done.ok()).toBeTruthy();

      await loginViaUI(page, user.email, user.password);
      const problems = watchForBreakage(page);
      const visited = new Set<string>([
        "/",
        "/login",
        "/login/sso",
        "/signup",
        "/signup/check-email",
        "/forgot-password",
        "/forgot-password/check-email",
        "/reset-password",
        "/two-factor",
      ]);
      const signedIn: Record<string, string> = {
        "/dashboard": "/dashboard",
        "/leads": "/leads",
        "/templates": "/templates",
        "/settings": "/settings",
        "/forms/[id]": `/forms/${formId}`,
        "/forms/[id]/share": `/forms/${formId}/share`,
        "/forms/[id]/responses": `/forms/${formId}/responses`,
        "/forms/[id]/responses/[responseId]": `/forms/${formId}/responses/${responseId}`,
        "/forms/[id]/integrations": `/forms/${formId}/integrations`,
        "/forms/[id]/settings": `/forms/${formId}/settings`,
      };
      for (const [route, path] of Object.entries(signedIn)) {
        await expectHealthy(page, path, problems);
        visited.add(route);
      }
      await expectHealthy(page, `/forms/${formId}/responses?view=incomplete`, problems);

      // The respondent side, in a clean (signed-out) context.
      const respondent = await browser.newContext({ ...test.info().project.use });
      const r = await respondent.newPage();
      const respondentProblems = watchForBreakage(r);
      await expectHealthy(r, liveLink, respondentProblems);
      await expect(r.getByText("Where can we reach you?")).toBeVisible();
      await respondent.close();
      visited.add("/f/[slug]");

      // The payment return page, for a response that's been paid.
      await adminClient().from("payments").insert({
        response_id: responseId,
        form_id: formId,
        amount: 1500,
        currency: "usd",
        status: "paid",
      });
      await expectHealthy(page, `${liveLink}/payment?response=${responseId}`, problems);
      await expect(page.getByRole("heading", { name: "Payment received" })).toBeVisible();
      visited.add("/f/[slug]/payment");

      // An invitation link that doesn't work explains itself.
      await expectHealthy(page, `/invite/${"x".repeat(43)}`, problems);
      await expect(page.getByText("This invitation doesn't work")).toBeVisible();
      visited.add("/invite/[token]");

      // Every registered page was actually visited above.
      expect([...visited].sort()).toEqual([...PAGE_ROUTES].sort());
    } finally {
      await deleteUser(user.userId);
    }
  });
});
