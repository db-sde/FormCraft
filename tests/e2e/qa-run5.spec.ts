import { test, expect, type APIRequestContext } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { setFormPassword } from "@/domains/forms/access";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
  waitForSaved,
} from "./helpers";

/**
 * QA run 5 (11 Nov 2026): the fixes that need the running app, one test
 * per finding (FC4-xx / FC5-xx).
 */
const theme = {
  primaryColor: "#1d4ed8",
  backgroundColor: "#ffffff",
  fontFamily: "inter",
  buttonStyle: "rounded",
} as const;

const form: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "QA run 5" },
  theme,
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "q_name",
      type: "short_text",
      order: 0,
      label: "Your name",
      required: false,
      settings: {},
    },
    {
      id: "q_notes",
      type: "long_text",
      order: 1,
      label: "Notes",
      required: true,
      settings: {},
    },
  ],
  logic: [],
} as FormSchemaV1;

async function start(request: APIRequestContext, formId: string): Promise<string> {
  const res = await request.post("/api/responses/start", { data: { formId } });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { responseId: string }).responseId;
}

const complete = (
  request: APIRequestContext,
  responseId: string,
  answers: Record<string, unknown>,
) =>
  request.post(`/api/responses/${responseId}/complete`, {
    data: {
      clientRevision: 1,
      lastQuestionId: "q_notes",
      answers,
      idempotencyKey: crypto.randomUUID(),
    },
  });

test.describe("QA run 5", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-qa5");
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("FC4-14: only the browser that started a response can write to it; a resume link claims it", async ({
    playwright,
    request,
    browser,
  }) => {
    const { formId } = await createPublishedForm(user, form);
    await adminClient()
      .from("forms")
      .update({ resume_links_enabled: true })
      .eq("id", formId);
    const responseId = await start(request, formId);

    // Someone else who only knows the id: refused everywhere.
    const stranger = await playwright.request.newContext();
    try {
      const writes = [
        await stranger.patch(`/api/responses/${responseId}/answers`, {
          data: { clientRevision: 1, lastQuestionId: "q_name", answers: { q_name: "x" } },
        }),
        await complete(stranger, responseId, { q_notes: "hijacked" }),
        await stranger.post(`/api/responses/${responseId}/resume-link`),
      ];
      for (const res of writes) {
        expect(res.status(), res.url()).toBe(403);
        expect((await res.json()).error.code).toBe("forbidden");
      }
    } finally {
      await stranger.dispose();
    }

    // The starter saves, and makes a resume link…
    const saved = await request.patch(`/api/responses/${responseId}/answers`, {
      data: { clientRevision: 1, lastQuestionId: "q_name", answers: { q_name: "Ada" } },
    });
    expect(saved.status()).toBe(200);
    const link = await request.post(`/api/responses/${responseId}/resume-link`);
    expect(link.status()).toBe(200);
    const { path } = (await link.json()) as { path: string };

    // …which finishes the response in another browser.
    const other = await browser.newContext();
    try {
      const page = await other.newPage();
      await page.goto(path);
      await expect(page.getByText("Picking up where you left off")).toBeVisible();
      await page.getByRole("button", { name: "OK" }).click();
      await page.getByLabel("Notes").fill("Finished elsewhere");
      await page.getByRole("button", { name: "Submit" }).click();
      await expect(page.getByRole("heading", { name: "Thanks" })).toBeVisible();
    } finally {
      await other.close();
    }
    const { data } = await adminClient()
      .from("responses")
      .select("status")
      .eq("id", responseId)
      .single();
    expect(data?.status).toBe("completed");
  });

  test("FC5-01 / FC5-02: answers after submit are refused; invisible-only answers don't count", async ({
    request,
  }) => {
    const { formId } = await createPublishedForm(user, form);
    const blank = await start(request, formId);
    const invisible = await complete(request, blank, { q_notes: "​​‍" });
    expect(invisible.status()).toBe(400);

    const responseId = await start(request, formId);
    expect((await complete(request, responseId, { q_notes: "Real" })).status()).toBe(200);
    const late = await request.patch(`/api/responses/${responseId}/answers`, {
      data: { clientRevision: 5, lastQuestionId: "x", answers: { q_notes: "changed" } },
    });
    expect(late.status()).toBe(409);
    expect((await late.json()).error.code).toBe("already_submitted");
  });

  test("FC4-03 / FC5-03 / FC5-04: views, unlock and start are checked and limited", async ({
    request,
  }) => {
    const { formId } = await createPublishedForm(user, form);

    // Views: only for a live form.
    const unknown = await request.post("/api/responses/view", {
      data: { formId: crypto.randomUUID() },
    });
    expect(unknown.status()).toBe(404);

    // Unlock: a form without a password says so.
    const noPassword = await request.post("/api/responses/unlock", {
      data: { formId, password: "x" },
    });
    expect(noPassword.status()).toBe(400);
    expect((await noPassword.json()).error.code).toBe("no_password");

    // Five tries in all (the one above counts), then refused.
    await setFormPassword(adminClient(), formId, "right-password");
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push(
        (
          await request.post("/api/responses/unlock", {
            data: { formId, password: `wrong-${i}` },
          })
        ).status(),
      );
    }
    expect(statuses.slice(0, 4)).toEqual([401, 401, 401, 401]);
    expect(statuses.slice(4)).toEqual([429, 429]);
  });

  test("FC4-03: a burst of starts from one address is refused", async ({ request }) => {
    const { formId } = await createPublishedForm(user, form);
    const statuses: number[] = [];
    for (let i = 0; i < 22; i += 1) {
      statuses.push(
        (await request.post("/api/responses/start", { data: { formId } })).status(),
      );
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(20);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });

  test("FC4-20: Enter on a focused checkbox ticks it", async ({ browser }) => {
    const { liveLink } = await createPublishedForm(user, {
      ...form,
      questions: [
        {
          id: "q_pick",
          type: "multi_select",
          order: 0,
          label: "Pick some",
          required: true,
          settings: {
            allowOther: false,
            options: [
              { id: "a", label: "Apples" },
              { id: "b", label: "Bananas" },
            ],
          },
        },
      ],
    } as FormSchemaV1);
    const visitor = await browser.newContext();
    try {
      const page = await visitor.newPage();
      await page.goto(liveLink);
      const apples = page.getByRole("checkbox", { name: /Apples/ });
      await apples.focus();
      await page.keyboard.press("Enter");
      await expect(apples).toBeChecked();
      await expect(page.getByText("This question requires an answer")).toHaveCount(0);
    } finally {
      await visitor.close();
    }
  });

  test("FC4-22: the builder undoes and redoes a move", async ({ page }) => {
    const { formId } = await createPublishedForm(user, form);
    const order = async () => {
      const { data } = await adminClient()
        .from("form_versions")
        .select("schema")
        .eq("form_id", formId)
        .eq("status", "draft")
        .single();
      return (data!.schema as unknown as FormSchemaV1).questions
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((q) => q.id);
    };
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}`);
    const list = page.getByRole("list", { name: "Questions" });
    await list.getByRole("button", { name: /^\d+ Notes/ }).click();
    await page.getByRole("button", { name: 'Move "Notes" up' }).click();
    await waitForSaved(page);
    await expect.poll(order).toEqual(["q_notes", "q_name"]);

    await page.getByRole("button", { name: "Undo last change" }).click();
    await waitForSaved(page);
    await expect.poll(order).toEqual(["q_name", "q_notes"]);

    // The keyboard too, outside a text field.
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await waitForSaved(page);
    await expect.poll(order).toEqual(["q_notes", "q_name"]);
  });
});

test.describe("QA run 6", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-qa6");
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("FC4-03: limits hold when every request comes from a different address", async ({
    request,
  }) => {
    // QA's tool sent each request through a relay with a new address, so
    // per-address limits never filled. These can't be stepped around.
    const { formId } = await createPublishedForm(user, form);
    const from = (i: number) => ({ "x-forwarded-for": `198.51.100.${i + 1}` });
    const statuses = async (send: (i: number) => Promise<{ status(): number }>) => {
      const out: number[] = [];
      for (let i = 0; i < 25; i += 1) out.push((await send(i)).status());
      return out;
    };

    const starts = await statuses((i) =>
      request.post("/api/responses/start", { data: { formId }, headers: from(i) }),
    );
    expect(starts.filter((s) => s === 200)).toHaveLength(20);
    expect(starts.slice(20).every((s) => s === 429)).toBe(true);

    const views = await statuses((i) =>
      request.post("/api/responses/view", {
        data: { formId },
        headers: { ...from(i), "user-agent": "Mozilla/5.0 Chrome/130" },
      }),
    );
    expect(views.slice(20).every((s) => s === 429)).toBe(true);

    await setFormPassword(adminClient(), formId, "right-password");
    const guesses = await statuses((i) =>
      request.post("/api/responses/unlock", {
        data: { formId, password: `wrong-${i}` },
        headers: from(100 + i),
      }),
    );
    expect(guesses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(guesses.slice(20).every((s) => s === 429)).toBe(true);
  });

  test("FC5-05: an over-long answer is named, not refused whole", async ({ request }) => {
    const { formId } = await createPublishedForm(user, form);
    const responseId = await start(request, formId);
    const res = await complete(request, responseId, { q_notes: "x".repeat(200_000) });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.errors[0]).toMatchObject({
      questionId: "q_notes",
      message: "Enter at most 10,000 characters.",
    });
  });

  test("FC5-05: the builder shows a long answer's 10,000-character default", async ({
    page,
  }) => {
    const { formId } = await createPublishedForm(user, form);
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}`);
    await page
      .getByRole("list", { name: "Questions" })
      .getByRole("button", { name: /^\d+ Notes/ })
      .click();
    const max = page.getByLabel("Max length");
    await expect(max).toHaveValue("");
    await expect(max).toHaveAttribute("placeholder", "10,000");
    await expect(page.getByText("Leave empty for the default, 10,000.")).toBeVisible();
  });
});
