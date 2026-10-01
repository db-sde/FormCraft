import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/**
 * Tenant isolation, end to end: a signed-in user must never see or act
 * on another workspace's forms, responses, leads or integrations, and a
 * signed-out visitor must never reach the app or its exports. These are
 * the regressions that would hurt most, so they're pinned here.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Private form" },
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
      label: "Contact",
      required: true,
      settings: { fields: ["name", "email"], requiredFields: ["email"] },
    },
  ],
  logic: [],
};

test("another workspace's data is invisible and untouchable", async ({
  page,
  request,
}) => {
  const owner = await createConfirmedUser("e2e-owner");
  const intruder = await createConfirmedUser("e2e-intruder");
  try {
    const { formId } = await createPublishedForm(owner, schema);
    const start = await request.post("/api/responses/start", { data: { formId } });
    const { responseId } = await start.json();
    await request.post(`/api/responses/${responseId}/complete`, {
      data: {
        clientRevision: 1,
        lastQuestionId: "q_contact",
        answers: { q_contact: { email: "secret-lead@example.com" } },
        idempotencyKey: crypto.randomUUID(),
      },
    });

    await loginViaUI(page, intruder.email, intruder.password);

    for (const path of [
      `/forms/${formId}`,
      `/forms/${formId}/share`,
      `/forms/${formId}/responses`,
      `/forms/${formId}/responses/${responseId}`,
      `/forms/${formId}/integrations`,
      `/forms/${formId}/settings`,
    ]) {
      // These pages stream behind a loading skeleton, so the HTTP status
      // is already sent (200) when the page decides it's a 404 — the
      // security property is the content: the not-found screen, no data.
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: "Page not found" }),
        path,
      ).toBeVisible();
      await expect(page.getByText("Private form"), path).toHaveCount(0);
      await expect(page.getByText("secret-lead@example.com"), path).toHaveCount(0);
    }

    const csv = await page.request.get(`/api/forms/${formId}/export.csv`);
    expect(csv.status()).toBe(404);

    for (const url of ["/api/leads/export.csv", `/api/leads/export.csv?form=${formId}`]) {
      const leads = await page.request.get(url);
      expect(leads.ok()).toBeTruthy();
      expect(await leads.text()).not.toContain("secret-lead@example.com");
    }

    await page.goto(`/leads?form=${formId}`);
    await expect(page.getByText("secret-lead@example.com")).toHaveCount(0);

    const authorize = await page.request.get(
      `/api/integrations/google/authorize?formId=${formId}`,
      { maxRedirects: 0 },
    );
    expect(authorize.status()).toBe(404);
  } finally {
    await deleteUser(intruder.userId);
    await deleteUser(owner.userId);
  }
});

test("the Google callback only accepts a connection this user's browser started", async ({
  page,
}) => {
  const owner = await createConfirmedUser("e2e-oauth");
  try {
    const { formId } = await createPublishedForm(owner, schema);
    await loginViaUI(page, owner.email, owner.password);

    // The old flow's state was just the form id — anyone could craft it.
    for (const state of [formId, "forged.state", ""]) {
      const res = await page.request.get(
        `/api/integrations/google/callback?code=abc&state=${encodeURIComponent(state)}`,
        { maxRedirects: 0 },
      );
      expect(res.status(), `state "${state}"`).toBe(400);
      expect((await res.json()).error.code).toBe("invalid_state");
    }
  } finally {
    await deleteUser(owner.userId);
  }
});

test("signed-out visitors are sent to log in, and exports refuse them", async ({
  page,
  request,
}) => {
  for (const path of ["/dashboard", "/leads", "/templates", "/settings"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/login\?next=/);
  }
  const fakeId = crypto.randomUUID();
  for (const url of [`/api/forms/${fakeId}/export.csv`, "/api/leads/export.csv"]) {
    const res = await request.get(url, { maxRedirects: 0 });
    expect(res.status(), url).not.toBe(200);
  }
});
