import { test, expect } from "@playwright/test";
import {
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/**
 * Journey 8 (docs/testing.md): duplicate submit protection. Driven at
 * the HTTP layer with Playwright's request context (rather than
 * through the UI) because the scenario being proven — a dropped
 * response to a successful request causing the client to retry the
 * exact same complete call — is a network condition, not a sequence
 * of clicks; hitting the real running server's real routes twice with
 * the same idempotency key is the actual claim under test.
 */
test.describe("duplicate submit protection", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedUser("e2e-dupsubmit");
    await loginViaUI(page, user.email, user.password);
  });

  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("retrying the same complete call with the same idempotency key never creates a duplicate", async ({
    page,
    request,
  }) => {
    // Known question ids (the starter form's are random), published
    // straight through the database.
    const { formId } = await createPublishedForm(user, {
      schemaVersion: 1,
      meta: { title: "Duplicate submit" },
      theme: {
        primaryColor: "#0f172a",
        backgroundColor: "#ffffff",
        fontFamily: "inter",
        buttonStyle: "rounded",
      },
      endings: [{ id: "end", title: "Thanks!", isDefault: true }],
      questions: [
        {
          id: "q_first",
          type: "short_text",
          order: 0,
          label: "Name",
          required: true,
          settings: {},
        },
      ],
      logic: [],
    });

    const startRes = await request.post("/api/responses/start", {
      data: { formId },
    });
    expect(startRes.ok()).toBeTruthy();
    const { responseId } = await startRes.json();

    const idempotencyKey = crypto.randomUUID();
    const completeBody = {
      clientRevision: 1,
      lastQuestionId: "q_first",
      answers: { q_first: "Duplicate Submit Test" },
      idempotencyKey,
    };

    const first = await request.post(`/api/responses/${responseId}/complete`, {
      data: completeBody,
    });
    expect(first.ok()).toBeTruthy();
    const firstBody = await first.json();

    // Simulate the client never seeing the first response (dropped
    // connection) and retrying with the identical idempotency key.
    const second = await request.post(`/api/responses/${responseId}/complete`, {
      data: completeBody,
    });
    expect(second.ok()).toBeTruthy();
    const secondBody = await second.json();

    expect(secondBody.endingId).toBe(firstBody.endingId);

    await page.goto(`/forms/${formId}/responses`);
    await expect(page.getByText("1 response", { exact: true })).toBeVisible({
      timeout: 10000,
    });
  });
});
