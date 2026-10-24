import { test, expect, type APIRequestContext } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/**
 * QA enhancements: search across responses (EN-01), Excel export
 * (EN-02) and the drop-off chart (EN-03).
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Enhancements" },
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
      settings: { fields: ["name", "email"], requiredFields: ["name"] },
    },
    {
      id: "q_idea",
      type: "long_text",
      order: 1,
      label: "Your idea",
      required: true,
      settings: {},
    },
  ],
  logic: [],
};

async function start(request: APIRequestContext, formId: string) {
  const res = await request.post("/api/responses/start", { data: { formId } });
  return ((await res.json()) as { responseId: string }).responseId;
}

async function submit(
  request: APIRequestContext,
  formId: string,
  name: string,
  idea: string,
) {
  const responseId = await start(request, formId);
  const res = await request.post(`/api/responses/${responseId}/complete`, {
    data: {
      clientRevision: 1,
      lastQuestionId: "q_idea",
      idempotencyKey: crypto.randomUUID(),
      answers: { q_contact: { name }, q_idea: idea },
    },
  });
  expect(res.status()).toBe(200);
}

test("search, Excel export and the drop-off chart", async ({ page, request }) => {
  const user = await createConfirmedUser("e2e-qa-enhancements");
  try {
    const { formId } = await createPublishedForm(user, schema);
    await submit(request, formId, "Ada Lovelace", "A dark mode for the editor");
    await submit(request, formId, "Grace Hopper", "Keyboard shortcuts everywhere");
    // One person gave their name, then left on the idea question.
    const left = await start(request, formId);
    await request.patch(`/api/responses/${left}/answers`, {
      data: {
        clientRevision: 1,
        lastQuestionId: "q_idea",
        answers: { q_contact: { name: "Alan Turing" } },
      },
    });

    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}/responses`);
    await expect(page.getByRole("cell", { name: /Grace Hopper/ })).toBeVisible();

    // EN-01: typing filters the table to responses that mention the text.
    await page.getByRole("searchbox", { name: "Search responses" }).fill("DARK MODE");
    await expect(page).toHaveURL(/search=DARK\+MODE/);
    await expect(page.getByRole("cell", { name: /Ada Lovelace/ })).toBeVisible();
    await expect(page.getByRole("cell", { name: /Grace Hopper/ })).toHaveCount(0);

    // EN-02: the export follows the search, as CSV or Excel.
    await page.getByRole("button", { name: "Export" }).click();
    const excelHref = await page
      .getByRole("menuitem", { name: "Excel (.xlsx)" })
      .getAttribute("href");
    expect(excelHref).toContain("search=DARK+MODE");
    expect(excelHref).toContain("format=xlsx");
    await page.keyboard.press("Escape");
    const excel = await page.request.get(excelHref!);
    expect(excel.headers()["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(excel.headers()["content-disposition"]).toContain(".xlsx");
    const bytes = await excel.body();
    expect(bytes.subarray(0, 2).toString()).toBe("PK"); // a zip, as .xlsx files are
    const leads = await page.request.get("/api/leads/export.csv?format=xlsx");
    expect(leads.headers()["content-disposition"]).toContain("leads.xlsx");

    // A search that matches nothing says so.
    await page.getByRole("searchbox", { name: "Search responses" }).fill("zebra");
    await expect(page.getByText("No responses mention “zebra”")).toBeVisible();

    // EN-03: Summary shows how far the three who started got.
    await page.goto(`/forms/${formId}/responses?tab=summary`);
    const chart = page.locator("section", {
      has: page.getByRole("heading", { name: "Drop-off by question" }),
    });
    await expect(chart).toContainText("How far the 3 people who started got");
    await expect(chart.getByRole("listitem").nth(0)).toContainText("100% reached");
    await expect(chart.getByRole("listitem").nth(1)).toContainText("100% reached");
    await expect(chart.getByRole("listitem").nth(1)).toContainText("1 stopped here");
    await expect(chart.getByRole("listitem").nth(2)).toContainText("67% · 2");
  } finally {
    await deleteUser(user.userId);
  }
});
