import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { FAKE_PLACES_PORT } from "../../playwright.config";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  addQuestion,
  deleteUser,
  loginViaUI,
  waitForSaved,
} from "./helpers";

/**
 * Features 49–68 (14 Nov 2026) as a respondent meets them: one test per
 * feature or close group, so a regression points at its card (F-xx).
 */
const theme = {
  primaryColor: "#1d4ed8",
  backgroundColor: "#ffffff",
  fontFamily: "inter",
  buttonStyle: "rounded",
} as const;

test.describe("features 49–68", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-f49");
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("F-51 / F-63 / F-58 / F-62 / F-60: progress words, no auto-advance, a stay, a notice, then a review with Edit", async ({
    browser,
  }) => {
    const form: FormSchemaV1 = {
      schemaVersion: 1,
      meta: { title: "Booking request", autoAdvance: false, reviewStep: true },
      theme: { ...theme, progressLabel: "count" },
      endings: [{ id: "end", title: "Request sent", isDefault: true }],
      questions: [
        {
          id: "q_room",
          type: "single_select",
          order: 0,
          label: "Which room?",
          required: true,
          settings: {
            allowOther: false,
            options: [
              { id: "single", label: "Single" },
              { id: "double", label: "Double" },
            ],
          },
        },
        {
          id: "q_stay",
          type: "date_range",
          order: 1,
          label: "When are you staying?",
          required: true,
          settings: { count: "nights", minDays: 2 },
        },
        {
          id: "q_notice",
          type: "consent",
          order: 2,
          label: "Before you send it",
          required: true,
          settings: {
            content: "## How we use this\n\nWe use your details to **reply** to you.",
            acknowledgeLabel: "I accept the notice",
            optInLabel: "Email me offers",
            versionLabel: "Notice v1",
          },
        },
        {
          id: "q_passport",
          type: "short_text",
          order: 3,
          label: "Passport number",
          required: false,
          sensitive: true,
          settings: {},
        },
      ],
      logic: [],
    } as FormSchemaV1;
    const { formId, liveLink } = await createPublishedForm(user, form);

    const visitor = await browser.newContext();
    try {
      const page = await visitor.newPage();
      await page.goto(liveLink);

      // F-51: the count beside the bar.
      await expect(page.getByText("Question 1 of 4")).toBeVisible();

      // F-63: choosing doesn't move on by itself when switched off.
      await page.getByRole("radio", { name: /Double/ }).click();
      await page.waitForTimeout(700);
      await expect(page.getByRole("heading", { name: /Which room/ })).toBeVisible();
      await page.getByRole("button", { name: "OK" }).click();

      // F-58: an end before the start is refused; a two-night stay works.
      await expect(page.getByText("Question 2 of 4")).toBeVisible();
      await page.getByLabel("Check-in").fill("2027-03-10");
      await page.getByLabel("Check-out").fill("2027-03-11");
      await page.getByRole("button", { name: "OK" }).click();
      await expect(page.getByText("Choose at least 2 nights.")).toBeVisible();
      await page.getByLabel("Check-out").fill("2027-03-12");
      await expect(page.getByText("2 nights")).toBeVisible();
      await page.getByRole("button", { name: "OK" }).click();

      // F-62: the notice is shown formatted; it won't go on unticked.
      await expect(
        page.getByRole("region", { name: "Notice" }).getByText("reply"),
      ).toHaveCSS("font-weight", "700");
      await page.getByRole("button", { name: "OK" }).click();
      await expect(page.getByText("Tick the box to go on.")).toBeVisible();
      await page.getByLabel("I accept the notice").check();
      await page.getByRole("button", { name: "OK" }).click();

      // The last question says "Review answers", not Submit (F-60).
      await page.getByLabel("Passport number").fill("X1234567");
      await page.getByRole("button", { name: "Review answers" }).click();
      const review = page.getByRole("heading", { name: "Check your answers" });
      await expect(review).toBeVisible();
      const items = page.locator('[data-fc="review-item"]');
      await expect(items).toHaveCount(4);
      await expect(items.nth(0)).toContainText("Double");
      await expect(items.nth(1)).toContainText("2027-03-10 – 2027-03-12 (2 nights)");
      await expect(items.nth(3)).toContainText("••••••••");
      await expect(items.nth(3)).not.toContainText("X1234567");

      // Edit the room: back to that question, then straight back here.
      await page.getByRole("button", { name: "Edit: Which room?" }).click();
      await page.getByRole("radio", { name: /Single/ }).click();
      await page.getByRole("button", { name: "OK" }).click();
      await expect(review).toBeVisible();
      await expect(items.nth(0)).toContainText("Single");

      // Only Submit on the review sends it.
      const { count: before } = await adminClient()
        .from("responses")
        .select("id", { count: "exact", head: true })
        .eq("form_id", formId)
        .eq("status", "completed");
      expect(before).toBe(0);
      await page.getByRole("button", { name: "Submit" }).click();
      await expect(page.getByRole("heading", { name: "Request sent" })).toBeVisible();
    } finally {
      await visitor.close();
    }

    // The server's record: its own night count, and the notice's version.
    const { data: rows } = await adminClient()
      .from("answers")
      .select("question_id, value, responses!inner(form_id, status)")
      .eq("responses.form_id", formId)
      .eq("responses.status", "completed");
    const byQuestion = Object.fromEntries(
      (rows ?? []).map((r) => [r.question_id, r.value]),
    );
    expect(byQuestion.q_room).toBe("single");
    expect(byQuestion.q_stay).toEqual({
      start: "2027-03-10",
      end: "2027-03-12",
      days: 2,
    });
    expect(byQuestion.q_notice).toMatchObject({
      acknowledged: true,
      optIn: false,
      versionLabel: "Notice v1",
    });
    expect((byQuestion.q_notice as { version: string }).version).toMatch(
      /^[0-9a-f]{16}$/,
    );
  });

  test("F-60: changing an answer from the review asks what the new branch needs", async ({
    browser,
  }) => {
    const form: FormSchemaV1 = {
      schemaVersion: 1,
      meta: { title: "Branching review", reviewStep: true },
      theme,
      endings: [{ id: "end", title: "Thanks", isDefault: true }],
      questions: [
        {
          id: "q_path",
          type: "yes_no",
          order: 0,
          label: "Do you have a company?",
          required: true,
          settings: {},
        },
        {
          id: "q_company",
          type: "short_text",
          order: 1,
          label: "Company name",
          required: true,
          settings: {},
          visibleIf: {
            type: "compare",
            left: { type: "answer", questionId: "q_path" },
            op: "is_true",
          },
        },
        {
          id: "q_name",
          type: "short_text",
          order: 2,
          label: "Your name",
          required: true,
          settings: {},
        },
      ],
      logic: [],
    } as FormSchemaV1;
    const { liveLink } = await createPublishedForm(user, form);
    const visitor = await browser.newContext();
    try {
      const page = await visitor.newPage();
      await page.goto(liveLink);
      await page.getByRole("radio", { name: /No/ }).click();
      await page.getByLabel("Your name").fill("Ada");
      await page.getByRole("button", { name: "Review answers" }).click();
      await expect(
        page.getByRole("heading", { name: "Check your answers" }),
      ).toBeVisible();
      await expect(page.locator('[data-fc="review-item"]')).toHaveCount(2);

      // Yes now: the company question is on the way, so it's asked.
      await page.getByRole("button", { name: "Edit: Do you have a company?" }).click();
      await page.getByRole("radio", { name: /Yes/ }).click();
      await expect(page.getByLabel("Company name")).toBeVisible();
      await page.getByLabel("Company name").fill("Acme");
      await page.getByRole("button", { name: "OK" }).click();
      await expect(
        page.getByRole("heading", { name: "Check your answers" }),
      ).toBeVisible();
      await expect(page.locator('[data-fc="review-item"]')).toHaveCount(3);
      await page.getByRole("button", { name: "Submit" }).click();
      await expect(page.getByRole("heading", { name: "Thanks" })).toBeVisible();
    } finally {
      await visitor.close();
    }
  });
  test("F-56: guests added and removed, a field only for children, errors that name the guest, and the export", async ({
    browser,
    page,
  }) => {
    const form: FormSchemaV1 = {
      schemaVersion: 1,
      meta: { title: "Party" },
      theme,
      endings: [{ id: "end", title: "See you there", isDefault: true }],
      questions: [
        {
          id: "q_guests",
          type: "repeat_group",
          order: 0,
          label: "Who's coming?",
          required: true,
          settings: {
            entryLabel: "Guest",
            minEntries: 1,
            maxEntries: 3,
            fields: [
              { id: "name", type: "short_text", label: "Name", required: true },
              { id: "child", type: "yes_no", label: "Under 12?", required: false },
              {
                id: "age",
                type: "number",
                label: "Age",
                required: true,
                showIf: { fieldId: "child", op: "equals", value: true },
              },
            ],
          },
        },
      ],
      logic: [],
    } as FormSchemaV1;
    const { formId, liveLink } = await createPublishedForm(user, form);
    const visitor = await browser.newContext();
    try {
      const r = await visitor.newPage();
      await r.goto(liveLink);
      const entries = r.locator('[data-fc="group-entry"]');
      await expect(entries).toHaveCount(1);
      await r.getByLabel("Guest 1: Name").fill("Ada");

      // A second guest, a child: Age appears for that guest only.
      await r.getByRole("button", { name: "Add another guest" }).click();
      await expect(entries).toHaveCount(2);
      await r.getByLabel("Guest 2: Name").fill("Bo");
      await entries.nth(1).getByRole("radio", { name: "Yes" }).check();
      await expect(r.getByLabel("Guest 2: Age")).toBeVisible();
      await expect(r.getByLabel("Guest 1: Age")).toHaveCount(0);

      // Left empty: the message says which guest.
      await r.getByRole("button", { name: "Submit" }).click();
      await expect(
        r.getByText("Guest 2: Age: This question requires an answer."),
      ).toBeVisible();
      await r.getByLabel("Guest 2: Age").fill("7");

      // A third added then removed; no more than three allowed.
      await r.getByRole("button", { name: "Add another guest" }).click();
      await expect(r.getByRole("button", { name: "Add another guest" })).toHaveCount(0);
      await r.getByRole("button", { name: "Remove Guest 3" }).click();
      await expect(entries).toHaveCount(2);

      await r.getByRole("button", { name: "Submit" }).click();
      await expect(r.getByRole("heading", { name: "See you there" })).toBeVisible();
    } finally {
      await visitor.close();
    }

    const { data: rows } = await adminClient()
      .from("answers")
      .select("value, responses!inner(form_id, status)")
      .eq("responses.form_id", formId)
      .eq("responses.status", "completed");
    const stored = rows?.[0]?.value as { values: Record<string, unknown> }[];
    expect(stored.map((e) => e.values)).toEqual([
      { name: "Ada" },
      { name: "Bo", child: true, age: 7 },
    ]);

    // The owner's export: a column per field, a line per guest.
    await loginViaUI(page, user.email, user.password);
    const csv = await (await page.request.get(`/api/forms/${formId}/export.csv`)).text();
    expect(csv).toContain("Who's coming? (Name)");
    expect(csv).toContain('"Ada\nBo"');
    expect(csv).toContain('"\nYes"');
  });
});

test.describe("F-52: the builder on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-f52");
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("a question added, named, reordered and made conditional, then published, all on a phone", async ({
    page,
  }, testInfo) => {
    const { formId } = await createPublishedForm(user, {
      schemaVersion: 1,
      meta: { title: "Phone form" },
      theme,
      endings: [{ id: "end", title: "Thanks", isDefault: true }],
      questions: [
        {
          id: "q_pet",
          type: "yes_no",
          order: 0,
          label: "Do you have a pet?",
          required: false,
          settings: {},
        },
      ],
      logic: [],
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
    const shot = (name: string) =>
      page.screenshot({ path: testInfo.outputPath(`${name}.png`) });

    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}`);
    const tabs = page.getByRole("navigation", { name: "Builder" });
    await expect(tabs).toBeVisible();
    await expect(page.getByText("best on a bigger screen")).toHaveCount(0);
    await shot("1-questions");

    // Add a question from the list: it opens for editing.
    await addQuestion(page, "Short text");
    await expect(page.getByLabel("Question text")).toBeVisible();
    await page.getByLabel("Question text").fill("What's its name?");
    await shot("2-edit");

    // Settings: made optional (new questions start required), and shown
    // only when the first answer is yes.
    await tabs.getByRole("button", { name: "Settings" }).click();
    const required = page.getByRole("switch", { name: /Required/ });
    await expect(required).toBeChecked();
    await required.click();
    await expect(required).not.toBeChecked();
    await page.getByRole("button", { name: "Only when…" }).click();
    await shot("3-settings");
    await waitForSaved(page);

    // Reorder without dragging: move it up, then back down.
    await tabs.getByRole("button", { name: "Questions" }).click();
    const list = page.getByRole("list", { name: "Questions" });
    await expect(
      list.getByRole("button", { name: `Move "What's its name?" up` }),
    ).toBeVisible();
    await list.getByRole("button", { name: `Move "What's its name?" up` }).click();
    await waitForSaved(page);
    await list.getByRole("button", { name: `Move "What's its name?" down` }).click();
    await waitForSaved(page);

    await expect
      .poll(async () => {
        const s = await draft();
        const q = s.questions.find((x) => x.label === "What's its name?");
        return {
          order: s.questions
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((x) => x.label),
          required: q?.required,
          conditional: !!q?.visibleIf,
        };
      })
      .toEqual({
        order: ["Do you have a pet?", "What's its name?"],
        required: false,
        conditional: true,
      });

    // Publish the changes from the phone.
    await page.getByRole("button", { name: "Publish changes" }).click();
    await expect(page.getByText("Republished.", { exact: true })).toBeVisible();
    const { data: live } = await adminClient()
      .from("form_versions")
      .select("schema")
      .eq("form_id", formId)
      .eq("status", "published")
      .single();
    expect(
      (live!.schema as unknown as FormSchemaV1).questions.map((q) => q.label),
    ).toContain("What's its name?");
    // The page never scrolls sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("F-65: address suggestions", () => {
  // One fake Places server on a fixed port: these run in one worker.
  test.describe.configure({ mode: "serial" });
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  let places: Server;
  const seen: { path: string; key: string | null; body: string }[] = [];
  test.beforeAll(async () => {
    // A stand-in for Google Places (New) on the port playwright.config sets.
    places = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({
          path: req.url ?? "",
          key: req.headers["x-goog-api-key"] as string,
          body,
        });
        res.setHeader("content-type", "application/json");
        if (req.url?.startsWith("/v1/places:autocomplete")) {
          res.end(
            JSON.stringify({
              suggestions: [
                {
                  placePrediction: {
                    placeId: "ChIJ_fake_place_1",
                    structuredFormat: {
                      mainText: { text: "10 Downing Street" },
                      secondaryText: { text: "London, UK" },
                    },
                  },
                },
              ],
            }),
          );
        } else if (req.url?.startsWith("/v1/places/ChIJ_fake_place_1")) {
          res.end(
            JSON.stringify({
              addressComponents: [
                { longText: "10", types: ["street_number"] },
                { longText: "Downing Street", types: ["route"] },
                { longText: "London", types: ["postal_town"] },
                { longText: "SW1A 2AA", types: ["postal_code"] },
                { longText: "United Kingdom", types: ["country"] },
              ],
            }),
          );
        } else {
          res.statusCode = 404;
          res.end("{}");
        }
      });
    });
    await new Promise<void>((resolve) =>
      places.listen(FAKE_PLACES_PORT, "127.0.0.1", resolve),
    );
  });
  test.afterAll(async () => {
    await new Promise((resolve) => places.close(resolve));
  });
  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-f65");
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("a suggestion fills the address; the key never reaches the browser; typing still works", async ({
    browser,
  }) => {
    const { formId, liveLink } = await createPublishedForm(user, {
      schemaVersion: 1,
      meta: { title: "Delivery" },
      theme,
      endings: [{ id: "end", title: "On its way", isDefault: true }],
      questions: [
        {
          id: "q_addr",
          type: "address",
          order: 0,
          label: "Where should we deliver?",
          required: true,
          settings: {
            fields: ["line1", "line2", "city", "postalCode", "country"],
            requiredFields: ["line1", "city", "country"],
            autocomplete: { countries: ["GB"] },
          },
        },
      ],
      logic: [],
    } as FormSchemaV1);
    const visitor = await browser.newContext();
    try {
      const page = await visitor.newPage();
      const browserCalls: string[] = [];
      page.on("request", (r) => browserCalls.push(r.url()));
      await page.goto(liveLink);
      const line1 = page.getByRole("combobox", { name: "Address line 1" });
      await line1.fill("10 Downing");
      const option = page.getByRole("option", { name: /10 Downing Street/ });
      await expect(option).toBeVisible();
      await expect(page.getByText("Suggestions from Google Maps")).toBeVisible();
      await line1.press("ArrowDown");
      await line1.press("Enter");
      await expect(page.getByLabel("City")).toHaveValue("London");
      await expect(page.getByLabel(/Postal code/)).toHaveValue("SW1A 2AA");
      await expect(line1).toHaveValue("10 Downing Street");
      // Line 2 stays theirs to type.
      await page.getByLabel(/Address line 2/).fill("Flat 3");
      await page.getByRole("button", { name: "Submit" }).click();
      await expect(page.getByRole("heading", { name: "On its way" })).toBeVisible();
      // The browser only ever spoke to FormCraft.
      expect(
        browserCalls.some((u) => u.includes("places.googleapis") || u.includes(":4605")),
      ).toBe(false);
    } finally {
      await visitor.close();
    }
    expect(seen.every((c) => c.key === "e2e-places-key")).toBe(true);
    expect(
      seen.find((c) => c.path.startsWith("/v1/places:autocomplete"))!.body,
    ).toContain('"includedRegionCodes":["gb"]');
    const { data } = await adminClient()
      .from("answers")
      .select("value, responses!inner(form_id)")
      .eq("responses.form_id", formId)
      .single();
    expect(data!.value).toEqual({
      line1: "10 Downing Street",
      line2: "Flat 3",
      city: "London",
      postalCode: "SW1A 2AA",
      country: "United Kingdom",
    });
  });

  test("a form without suggestions switched on gets none", async ({ request }) => {
    const { formId } = await createPublishedForm(user, {
      schemaVersion: 1,
      meta: { title: "Plain" },
      theme,
      endings: [{ id: "end", title: "Thanks", isDefault: true }],
      questions: [
        {
          id: "q_addr",
          type: "address",
          order: 0,
          label: "Address",
          required: false,
          settings: { fields: ["line1", "city"], requiredFields: [] },
        },
      ],
      logic: [],
    } as FormSchemaV1);
    const res = await request.post("/api/places", {
      data: {
        action: "suggest",
        formId,
        questionId: "q_addr",
        sessionToken: "abcdefghijklmnop1234",
        text: "10 Downing",
      },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe("F-61: custom templates", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-f61");
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("a form saved as a template makes new forms with its questions, not its responses", async ({
    page,
    request,
  }) => {
    const { formId, liveLink } = await createPublishedForm(user, {
      schemaVersion: 1,
      meta: { title: "Event signup" },
      theme,
      endings: [{ id: "end", title: "See you", isDefault: true }],
      questions: [
        {
          id: "q_name",
          type: "short_text",
          order: 0,
          label: "Your name",
          required: true,
          settings: {},
        },
      ],
      logic: [],
    } as FormSchemaV1);
    // A response the template must not carry.
    const started = await request.post("/api/responses/start", { data: { formId } });
    const { responseId } = await started.json();
    await request.post(`/api/responses/${responseId}/complete`, {
      data: {
        clientRevision: 1,
        lastQuestionId: "q_name",
        answers: { q_name: "Ada" },
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(liveLink).toBeTruthy();

    await loginViaUI(page, user.email, user.password);
    await page
      .getByRole("button", { name: 'Actions for "Event signup"' })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Save as template" }).click();
    const dialog = page.getByRole("dialog", { name: "Save as template" });
    await dialog.getByLabel("Template name").fill("Signup starter");
    await dialog.getByLabel("Only me").check();
    await dialog.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText("Saved as a template.")).toBeVisible();

    await page.goto("/templates");
    // Search, rename with a category, and duplicate.
    await page.getByLabel("Search your templates").fill("nothing like it");
    await expect(page.getByText("No templates match.")).toBeVisible();
    await page.getByLabel("Search your templates").fill("signup");
    const card = page.getByTestId("workspace-template").filter({
      has: page.getByRole("heading", { name: "Signup starter", exact: true }),
    });
    await card.getByRole("button", { name: /Rename template/ }).click();
    const details = page.getByRole("dialog", { name: "Template details" });
    await details.getByLabel("Category").fill("Events");
    await details.getByRole("button", { name: "Save" }).click();
    await expect(card).toContainText("Events");
    await card.getByRole("button", { name: /Duplicate template/ }).click();
    await expect(
      page.getByTestId("workspace-template").filter({ hasText: "Signup starter (copy)" }),
    ).toBeVisible();
    await expect(card).toContainText("Only you");
    await card.getByRole("button", { name: "Use this template" }).click();
    await page.waitForURL(/\/forms\/[0-9a-f-]{36}$/);
    const newId = page.url().split("/").pop()!;
    expect(newId).not.toBe(formId);

    const { data: draft } = await adminClient()
      .from("form_versions")
      .select("schema")
      .eq("form_id", newId)
      .eq("status", "draft")
      .single();
    const schema = draft!.schema as unknown as FormSchemaV1;
    expect(schema.meta.title).toBe("Signup starter");
    expect(schema.questions.map((q) => q.label)).toEqual(["Your name"]);
    expect(schema.questions[0].id).not.toBe("q_name");
    const { count } = await adminClient()
      .from("responses")
      .select("id", { count: "exact", head: true })
      .eq("form_id", newId);
    expect(count).toBe(0);
  });
});

test.describe("F-52 / F-56 / F-60 on a phone, continued", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-phone2");
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("F-52: a new form from the phone dashboard; an edit made offline saves when back online; drag by touch", async ({
    page,
    context,
  }) => {
    await loginViaUI(page, user.email, user.password);
    // On a phone, New form is in the menu.
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "New form" }).click();
    await page.waitForURL(/\/forms\/[0-9a-f-]{36}$/);
    const formId = page.url().split("/").pop()!;
    const tabs = page.getByRole("navigation", { name: "Builder" });
    await expect(tabs).toBeVisible();
    await addQuestion(page, "Short text");
    await page.getByLabel("Question text").fill("First");
    await waitForSaved(page);
    await tabs.getByRole("button", { name: "Questions" }).click();
    await addQuestion(page, "Short text");
    await page.getByLabel("Question text").fill("Second");
    await waitForSaved(page);

    // Offline: the edit waits; back online, it's saved.
    await context.setOffline(true);
    await page.getByLabel("Question text").fill("Second, edited offline");
    await expect(page.locator('[data-save-state="saved"]')).toHaveCount(0, {
      timeout: 15000,
    });
    await context.setOffline(false);
    await waitForSaved(page);
    const labels = async () => {
      const { data } = await adminClient()
        .from("form_versions")
        .select("schema")
        .eq("form_id", formId)
        .eq("status", "draft")
        .single();
      return (data!.schema as unknown as FormSchemaV1).questions
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((q) => q.label);
    };
    await expect.poll(labels).toContain("Second, edited offline");

    // Drag "Second, edited offline" above "First" with a finger.
    await tabs.getByRole("button", { name: "Questions" }).click();
    const list = page.getByRole("list", { name: "Questions" });
    const rows = list.getByRole("listitem");
    const from = rows.filter({ hasText: "Second, edited offline" });
    const to = rows.filter({ hasText: "First" });
    const grip = from.locator("[data-drag-handle]");
    const start = (await grip.boundingBox())!;
    const target = (await to.boundingBox())!;
    const point = (x: number, y: number) => ({
      pointerType: "touch",
      pointerId: 7,
      isPrimary: true,
      clientX: x,
      clientY: y,
      bubbles: true,
    });
    await grip.dispatchEvent("pointerdown", point(start.x + 4, start.y + 4));
    await grip.dispatchEvent(
      "pointermove",
      point(target.x + target.width / 2, target.y + target.height / 2),
    );
    await grip.dispatchEvent(
      "pointerup",
      point(target.x + target.width / 2, target.y + target.height / 2),
    );
    // The drop autosaves: wait for the new order to reach the draft.
    await expect
      .poll(async () =>
        (await labels()).filter((l) => ["First", "Second, edited offline"].includes(l)),
      )
      .toEqual(["Second, edited offline", "First"]);
  });

  test("F-56: a half-filled group survives a refresh, in order", async ({ browser }) => {
    const { formId, liveLink } = await createPublishedForm(user, {
      schemaVersion: 1,
      meta: { title: "Team" },
      theme,
      endings: [{ id: "end", title: "Done", isDefault: true }],
      questions: [
        {
          id: "q_team",
          type: "repeat_group",
          order: 0,
          label: "Your team",
          required: true,
          settings: {
            entryLabel: "Member",
            minEntries: 1,
            maxEntries: 5,
            fields: [{ id: "name", type: "short_text", label: "Name", required: true }],
          },
        },
        {
          id: "q_note",
          type: "long_text",
          order: 1,
          label: "Anything else?",
          required: false,
          settings: {},
        },
      ],
      logic: [],
    } as FormSchemaV1);
    await adminClient()
      .from("forms")
      .update({ save_partial_responses: true })
      .eq("id", formId);
    const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const r = await visitor.newPage();
      await r.goto(liveLink);
      await r.getByLabel("Member 1: Name").fill("Ada");
      await r.getByRole("button", { name: "Add another member" }).click();
      await r.getByLabel("Member 2: Name").fill("Bo");
      await r.getByRole("button", { name: "Add another member" }).click();
      await r.getByLabel("Member 3: Name").fill("Cy");
      await r.getByRole("button", { name: "OK" }).click();
      await expect(r.getByLabel("Anything else?")).toBeVisible();
      await r.waitForTimeout(1500);
      await r.reload();
      // Back where they were; going back shows the three, in order.
      await expect(r.getByLabel("Anything else?")).toBeVisible();
      await r.getByRole("button", { name: "Back" }).click();
      await expect(r.getByLabel("Member 1: Name")).toHaveValue("Ada");
      await expect(r.getByLabel("Member 2: Name")).toHaveValue("Bo");
      await expect(r.getByLabel("Member 3: Name")).toHaveValue("Cy");
    } finally {
      await visitor.close();
    }
  });

  test("F-60: the review on a phone lists an uploaded file by name", async ({
    browser,
  }) => {
    const { liveLink } = await createPublishedForm(user, {
      schemaVersion: 1,
      meta: { title: "Claim", reviewStep: true },
      theme,
      endings: [{ id: "end", title: "Claim sent", isDefault: true }],
      questions: [
        {
          id: "q_receipt",
          type: "file_upload",
          order: 0,
          label: "Receipt",
          required: true,
          settings: { acceptedMimeTypes: ["image/*"], maxSizeMb: 2 },
        },
      ],
      logic: [],
    } as FormSchemaV1);
    const png = Buffer.alloc(1024);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const r = await visitor.newPage();
      await r.goto(liveLink);
      await r
        .locator('input[type="file"]')
        .setInputFiles({ name: "taxi-receipt.png", mimeType: "image/png", buffer: png });
      await r.getByRole("button", { name: "Review answers" }).click();
      await expect(r.getByRole("heading", { name: "Check your answers" })).toBeVisible();
      await expect(r.locator('[data-fc="review-item"]')).toContainText(
        "taxi-receipt.png",
      );
      const width = await r.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(width).toBeLessThanOrEqual(0);
      await r.getByRole("button", { name: "Submit" }).click();
      await expect(r.getByRole("heading", { name: "Claim sent" })).toBeVisible();
    } finally {
      await visitor.close();
    }
  });
});
