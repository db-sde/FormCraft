import { test, expect, type APIRequestContext } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  addQuestion,
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
  waitForSaved,
} from "./helpers";

/**
 * QA run 4 (11 Nov 2026): the fixes that need the running app. One test
 * per finding (FC4-xx), so a regression points at its report entry.
 */
const theme = {
  primaryColor: "#1d4ed8",
  backgroundColor: "#ffffff",
  fontFamily: "inter",
  buttonStyle: "rounded",
} as const;

const png = (size = 1024) => {
  const bytes = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  return bytes;
};

async function start(request: APIRequestContext, formId: string): Promise<string> {
  const res = await request.post("/api/responses/start", { data: { formId } });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { responseId: string }).responseId;
}

const quiz: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "QA quiz" },
  theme,
  endings: [
    { id: "end", title: "You scored {{score}}", isDefault: true },
    { id: "top", title: "Top marks: {{score}}" },
  ],
  questions: [
    {
      id: "q1",
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
            correct: true,
            scores: [{ variableId: "s", points: 10 }],
          },
          { id: "rome", label: "Rome" },
        ],
      },
    },
  ],
  variables: [{ id: "s", name: "score", type: "number" }],
  rules: [
    {
      id: "top",
      on: { event: "form_completed" },
      when: {
        type: "compare",
        left: { type: "variable", variableId: "s" },
        op: "gte",
        right: { type: "literal", value: 10 },
      },
      then: [{ type: "jump_to_ending", endingId: "top" }],
    },
  ],
  logic: [],
} as FormSchemaV1;

test.describe("QA run 4", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-qa4");
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("FC4-02: quiz answers and points aren't in the page, and the ending still shows the score", async ({
    browser,
    request,
  }) => {
    const { liveLink } = await createPublishedForm(user, quiz);
    const html = await (await request.get(liveLink)).text();
    expect(html).toContain("Capital of France?");
    expect(html).not.toMatch(/\\?"correct\\?":\s*true/);
    expect(html).not.toMatch(/\\?"points\\?"/);

    const visitor = await browser.newContext();
    const page = await visitor.newPage();
    await page.goto(liveLink);
    await page.getByRole("radio", { name: /Paris/ }).click();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("heading", { name: "Top marks: 10" })).toBeVisible();
    await visitor.close();
  });

  test("FC4-04: a finished response refuses a second, different submission", async ({
    request,
  }) => {
    const { formId } = await createPublishedForm(user, quiz);
    const responseId = await start(request, formId);
    const submit = (key: string, answer: string) =>
      request.post(`/api/responses/${responseId}/complete`, {
        data: {
          clientRevision: 1,
          lastQuestionId: "q1",
          answers: { q1: answer },
          idempotencyKey: key,
        },
      });
    const key = crypto.randomUUID();
    expect((await submit(key, "paris")).status()).toBe(200);
    // The same submission again (a lost reply): the same answer.
    expect((await submit(key, "paris")).status()).toBe(200);
    // Another one: refused, and nothing changes.
    const other = await submit(crypto.randomUUID(), "rome");
    expect(other.status()).toBe(409);
    expect((await other.json()).error.code).toBe("already_submitted");
    const { data } = await adminClient()
      .from("answers")
      .select("value")
      .eq("response_id", responseId);
    expect(data).toEqual([{ value: "paris" }]);
  });

  test("FC4-18: a Contact info question with Company asks for it", async ({
    browser,
  }) => {
    const { liveLink } = await createPublishedForm(user, {
      ...quiz,
      variables: [],
      rules: [],
      endings: [{ id: "end", title: "Thanks", isDefault: true }],
      questions: [
        {
          id: "q_contact",
          type: "contact_info",
          order: 0,
          label: "Your details",
          required: false,
          settings: { fields: ["name", "email", "company"], requiredFields: [] },
        },
      ],
    } as FormSchemaV1);
    const visitor = await browser.newContext();
    const page = await visitor.newPage();
    await page.goto(liveLink);
    // One detail per screen: Name, Email, then Company.
    await page.getByLabel("Name").fill("Ada");
    await page.getByRole("button", { name: "OK" }).click();
    await page.getByLabel("Email").fill("ada@example.com");
    await page.getByRole("button", { name: "OK" }).click();
    await expect(page.getByLabel("Company")).toBeVisible();
    await visitor.close();
  });

  test("FC4-15: unknown API addresses and responses get a JSON 404", async ({
    request,
  }) => {
    const missing = "00000000-0000-4000-8000-000000000000";
    for (const res of [
      await request.post(`/api/responses/${missing}`),
      await request.delete(`/api/responses/${missing}`),
      await request.get("/api/no-such-thing"),
      await request.post(`/api/responses/${missing}/lookup`, {
        data: { questionId: "q1", answers: {} },
      }),
    ]) {
      expect(res.status(), res.url()).toBe(404);
      expect((await res.json()).error.code).toBe("not_found");
    }
  });

  test("FC4-17 / FC4-30: a file answer's export link opens for the owner only; robots.txt is real", async ({
    page,
    request,
    browser,
  }) => {
    const { formId } = await createPublishedForm(user, {
      ...quiz,
      variables: [],
      rules: [],
      endings: [{ id: "end", title: "Thanks", isDefault: true }],
      questions: [
        {
          id: "q_file",
          type: "file_upload",
          order: 0,
          label: "Your CV",
          required: false,
          settings: { acceptedMimeTypes: ["image/*"], maxSizeMb: 1 },
        },
      ],
    } as FormSchemaV1);
    const responseId = await start(request, formId);
    const uploaded = await request.post(`/api/responses/${responseId}/uploads/q_file`, {
      multipart: { file: { name: "cv.png", mimeType: "image/png", buffer: png() } },
    });
    const { uploadId } = (await uploaded.json()) as { uploadId: string };
    await request.post(`/api/responses/${responseId}/complete`, {
      data: {
        clientRevision: 1,
        lastQuestionId: "q_file",
        answers: { q_file: uploadId },
        idempotencyKey: crypto.randomUUID(),
      },
    });

    // Signed out: sent to log in.
    const anonymous = await request.get(`/api/uploads/${uploadId}`, { maxRedirects: 0 });
    expect(anonymous.status()).toBe(307);
    expect(anonymous.headers().location).toContain("/login");

    // The owner: the CSV has the name and a link, and the link serves it.
    await loginViaUI(page, user.email, user.password);
    const csv = await (await page.request.get(`/api/forms/${formId}/export.csv`)).text();
    expect(csv).toContain("Your CV (link)");
    expect(csv).toContain("cv.png");
    expect(csv).toContain(`/api/uploads/${uploadId}`);
    const own = await page.request.get(`/api/uploads/${uploadId}`, { maxRedirects: 0 });
    expect(own.status()).toBe(307);
    expect(own.headers().location).toContain("token=");

    // Someone else signed in: nothing.
    const stranger = await createConfirmedUser("e2e-qa4-stranger");
    const other = await browser.newContext();
    try {
      const otherPage = await other.newPage();
      await loginViaUI(otherPage, stranger.email, stranger.password);
      const res = await otherPage.request.get(`/api/uploads/${uploadId}`, {
        maxRedirects: 0,
      });
      expect(res.status()).toBe(404);
    } finally {
      await other.close();
      await deleteUser(stranger.userId);
    }

    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain("Disallow: /dashboard");
  });

  test("FC4-05 / FC4-06 / FC4-09: picture upload, question drag, and an unfinished booking question", async ({
    page,
  }) => {
    const { formId } = await createPublishedForm(user, {
      ...quiz,
      variables: [],
      rules: [],
      endings: [{ id: "end", title: "Thanks", isDefault: true }],
      questions: [
        {
          id: "q_colour",
          type: "single_select",
          order: 0,
          label: "Favourite colour",
          required: false,
          settings: {
            allowOther: false,
            layout: "pictures",
            options: [
              { id: "blue", label: "Blue" },
              { id: "red", label: "Red" },
            ],
          },
        },
        {
          id: "q_two",
          type: "short_text",
          order: 1,
          label: "Second",
          required: false,
          settings: {},
        },
        {
          id: "q_three",
          type: "short_text",
          order: 2,
          label: "Third",
          required: false,
          settings: {},
        },
      ],
    } as FormSchemaV1);
    const draft = async () => {
      const { data } = await adminClient()
        .from("form_versions")
        .select("schema")
        .eq("form_id", formId)
        .eq("status", "draft")
        .single();
      return data!.schema as unknown as FormSchemaV1;
    };

    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}`);
    const list = page.getByRole("list", { name: "Questions" });

    // FC4-05: an option picture uploads (the "·" in "A · Blue" broke it).
    await list.getByRole("button", { name: /^\d+ Favourite colour/ }).click();
    await expect(page.getByText("Picture choice").first()).toBeVisible();
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: "blue.png", mimeType: "image/png", buffer: png() });
    await expect(page.getByText("The upload failed")).toHaveCount(0);
    await waitForSaved(page);
    await expect
      .poll(async () => {
        const q = (await draft()).questions.find((x) => x.id === "q_colour")!;
        return (q.settings as { options: { imageUrl?: string }[] }).options[0].imageUrl;
      })
      .toContain("/theme-assets/");

    // FC4-06: dragging "Third" by its grip onto "Favourite colour".
    const rows = list.getByRole("listitem");
    await rows.nth(2).hover();
    await rows.nth(2).locator('[draggable="true"]').dragTo(rows.nth(0));
    await waitForSaved(page);
    await expect
      .poll(async () =>
        (await draft()).questions
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((q) => q.id),
      )
      .toEqual(["q_three", "q_colour", "q_two"]);

    // FC4-09: a Booking question without its type doesn't stop saving.
    await addQuestion(page, "Booking");
    await list.getByRole("button", { name: /^\d+ Second/ }).click();
    await page.getByLabel("Question text").fill("Second, edited");
    await waitForSaved(page);
    await expect(page.getByText(/Not saved/)).toHaveCount(0);
    await expect
      .poll(async () => (await draft()).questions.map((q) => q.label))
      .toContain("Second, edited");
  });
});
