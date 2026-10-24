import { test, expect, type APIRequestContext } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/**
 * The QA retest of 23 October 2026 (FC-01…FC-21), replayed the way QA
 * found each problem. Views and fast exits: views-and-exit-save.spec.ts;
 * embeds: embed.spec.ts.
 */
const theme = {
  primaryColor: "#4f46e5",
  backgroundColor: "#ffffff",
  fontFamily: "inter",
  buttonStyle: "rounded",
} as const;

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "QA retest" },
  theme,
  variables: [{ id: "v_score", name: "score", type: "number" }],
  endings: [{ id: "end", title: "Thanks! Your score: {{score}}", isDefault: true }],
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
      id: "q_short",
      type: "short_text",
      order: 1,
      label: "QA short",
      required: true,
      settings: {},
    },
    {
      id: "q_phone",
      type: "phone",
      order: 2,
      label: "QA phone",
      required: false,
      settings: {},
    },
    {
      id: "q_url",
      type: "url",
      order: 3,
      label: "QA website",
      required: false,
      settings: {},
    },
    {
      id: "q_date",
      type: "date",
      order: 4,
      label: "QA date",
      required: false,
      settings: {},
    },
  ],
  logic: [],
  rules: [
    {
      id: "r_score",
      name: "Ten points",
      on: { event: "question_answered", questionId: "q_short" },
      then: [
        {
          type: "set_variable",
          variableId: "v_score",
          op: "add",
          value: { type: "literal", value: 10 },
        },
      ],
    },
  ],
};

async function submit(request: APIRequestContext, formId: string) {
  const start = await request.post("/api/responses/start", { data: { formId } });
  const { responseId } = (await start.json()) as { responseId: string };
  const done = await request.post(`/api/responses/${responseId}/complete`, {
    data: {
      clientRevision: 1,
      lastQuestionId: "q_date",
      idempotencyKey: crypto.randomUUID(),
      answers: {
        q_contact: { name: "Grace Hopper", email: "grace@example.com" },
        q_short: "Café crème",
        q_phone: "+1 555 010 2030",
        q_url: "example.com",
        q_date: "2026-11-01",
      },
    },
  });
  expect(done.status()).toBe(200);
}

test("responses: every question has a column, endings show the real score, and the CSV has results and opens in Excel", async ({
  page,
  request,
}) => {
  const user = await createConfirmedUser("e2e-qa-responses");
  try {
    const { formId } = await createPublishedForm(user, schema);
    await submit(request, formId);
    await loginViaUI(page, user.email, user.password);

    // FC-06: a column for every question, not just the first few.
    await page.goto(`/forms/${formId}/responses`);
    for (const label of ["Contact", "QA short", "QA phone", "QA website", "QA date"]) {
      await expect(page.getByRole("columnheader", { name: label })).toBeVisible();
    }
    // FC-09: the ending reads as the respondent saw it.
    await expect(
      page.getByRole("cell", { name: "Thanks! Your score: 10" }),
    ).toBeVisible();
    await expect(page.getByText("{{score}}")).toHaveCount(0);

    // FC-08: a column per result, and a byte-order mark for Excel.
    const csv = await page.request.get(`/api/forms/${formId}/export.csv`);
    const bytes = await csv.body();
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const [header, row] = bytes.toString("utf8").replace(/^﻿/, "").split("\r\n");
    const columns = header.split(",");
    const cells = row.split(",");
    expect(cells[columns.indexOf("score")]).toBe("10");
    expect(cells[columns.indexOf("Ending")]).toBe("Thanks! Your score: 10");
    expect(row).toContain("Café crème");
  } finally {
    await deleteUser(user.userId);
  }
});

test("dashboard: unpublishing asks first, and deleting a form says its leads go too", async ({
  page,
  request,
}) => {
  const user = await createConfirmedUser("e2e-qa-dashboard");
  try {
    const { formId } = await createPublishedForm(user, schema);
    await submit(request, formId);
    await loginViaUI(page, user.email, user.password);

    // FC-12: Unpublish needs confirming; keeping it live changes nothing.
    await page.getByRole("button", { name: 'Actions for "QA retest"' }).click();
    await page.getByRole("menuitem", { name: "Unpublish" }).click();
    const unpublish = page.getByRole("alertdialog", { name: /Unpublish/ });
    await expect(unpublish).toContainText("stop working");
    await unpublish.getByRole("button", { name: "Keep it live" }).click();
    await expect(page.getByText("Unpublished.", { exact: true })).toHaveCount(0);

    // FC-16: the delete dialog counts the leads that would go with it.
    await page.getByRole("button", { name: 'Actions for "QA retest"' }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const remove = page.getByRole("alertdialog", { name: /Delete/ });
    await expect(remove).toContainText("Its lead is removed from Leads too");
    await remove.getByRole("button", { name: "Cancel" }).click();

    // …and a single lead can be deleted from Leads.
    await page.goto("/leads");
    await page.getByRole("button", { name: "Delete lead" }).click();
    const lead = page.getByRole("alertdialog", { name: "Delete this lead?" });
    await expect(lead).toContainText("Grace Hopper");
    await lead.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("No leads yet")).toBeVisible();
  } finally {
    await deleteUser(user.userId);
  }
});

test("builder: deletes can be undone, the publish button keeps one label, and unconfigured integrations stay hidden", async ({
  page,
}) => {
  const user = await createConfirmedUser("e2e-qa-builder");
  try {
    const { formId } = await createPublishedForm(user, schema);
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}`);

    // FC-17: nothing to publish yet, and it says so.
    await expect(
      page.getByRole("button", { name: "Published", exact: true }),
    ).toBeDisabled();

    // FC-11: a deleted question comes back with Undo.
    await page
      .getByRole("button", { name: /QA website/ })
      .first()
      .click();
    await page.getByRole("button", { name: 'Delete "QA website"' }).click();
    await expect(page.getByRole("button", { name: 'Delete "QA website"' })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: 'Delete "QA website"' })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Publish changes", exact: true }),
    ).toBeVisible({ timeout: 15000 });

    // FC-03 / FC-04: without email or Google credentials on this server,
    // their settings aren't offered, and the checklist doesn't ask for Sheets.
    await page.goto(`/forms/${formId}/integrations`);
    await expect(page.getByRole("heading", { name: "Webhooks" })).toBeVisible();
    for (const hidden of ["Google Sheets", "Email notifications", "Confirmation email"]) {
      await expect(page.getByRole("heading", { name: hidden })).toHaveCount(0);
    }
    await expect(page.getByText("Get your first response").first()).toBeVisible();
    await expect(page.getByText("Connect Google Sheets")).toHaveCount(0);
  } finally {
    await deleteUser(user.userId);
  }
});

const respondentSchema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "QA respondent" },
  theme,
  endings: [{ id: "end", title: "Thanks!", isDefault: true }],
  questions: [
    {
      id: "q_pick",
      type: "single_select",
      order: 0,
      label: "Pick one",
      required: true,
      settings: { allowOther: true, options: [{ id: "o_a", label: "A" }] },
    },
    {
      id: "q_file",
      type: "file_upload",
      order: 1,
      label: "Attach a file",
      required: false,
      settings: { acceptedMimeTypes: ["image/*", "application/pdf"], maxSizeMb: 5 },
    },
  ],
  logic: [],
};

test("respondent: Enter after typing Other moves on, and a wrong file is turned down at once", async ({
  page,
}) => {
  const user = await createConfirmedUser("e2e-qa-respondent");
  try {
    const { liveLink } = await createPublishedForm(user, respondentSchema);
    await page.goto(liveLink);

    // FC-21: Enter in the Other box is "OK".
    await page.getByRole("radio", { name: /Other/ }).click();
    await page.getByRole("textbox", { name: "Your answer" }).fill("Something else");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Attach a file")).toBeVisible();

    // FC-10: refused before uploading, with the reason.
    let uploads = 0;
    page.on("request", (r) => {
      if (r.url().includes("/uploads/")) uploads += 1;
    });
    const input = page.locator('input[type="file"]');
    await input.setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });
    await expect(
      page.getByText(
        "That kind of file can't be uploaded here. Allowed: Images, PDF files.",
      ),
    ).toBeVisible();
    await input.setInputFiles({
      name: "huge.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(6 * 1024 * 1024),
    });
    await expect(
      page.getByText("That file is larger than 5 MB. Choose a smaller one."),
    ).toBeVisible();
    expect(uploads).toBe(0);
  } finally {
    await deleteUser(user.userId);
  }
});
