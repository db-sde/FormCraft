import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
  logOutViaUI,
} from "./helpers";

/**
 * Security checklist of 26 Oct 2026, the parts that need a browser:
 * sessions end on the server at logout, protected pages (and their data
 * requests) need a session, and a respondent's file is only ever
 * downloaded, never rendered.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Checklist" },
  theme: {
    primaryColor: "#4f46e5",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks!", isDefault: true }],
  questions: [
    {
      id: "q_file",
      type: "file_upload",
      order: 0,
      label: "Attach your logo",
      required: true,
      settings: { acceptedMimeTypes: ["image/png"], maxSizeMb: 1 },
    },
  ],
  logic: [],
};

// A real 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("after logging out, the old session cookie no longer opens anything", async ({
  page,
  browser,
}) => {
  const user = await createConfirmedUser("e2e-sec-logout");
  try {
    await loginViaUI(page, user.email, user.password);
    const stolen = await page.context().cookies();
    await logOutViaUI(page);

    // Someone replays the cookies captured before the logout.
    const attacker = await browser.newContext();
    await attacker.addCookies(stolen);
    const replay = await attacker.newPage();
    await replay.goto("/dashboard");
    await expect(replay).toHaveURL(/\/login/);
    await attacker.close();
  } finally {
    await deleteUser(user.userId);
  }
});

test("protected pages and their data requests need a session", async ({ request }) => {
  for (const path of ["/dashboard", "/leads", "/settings", "/templates"]) {
    // A plain page load, and the RSC data request the app makes on navigation.
    for (const headers of [{}, { RSC: "1" }] as Record<string, string>[]) {
      const res = await request.get(path, { headers, maxRedirects: 0 });
      expect(res.status(), `${path} ${JSON.stringify(headers)}`).toBe(307);
      expect(res.headers()["location"]).toContain("/login");
    }
  }
});

test("a respondent's uploaded file opens as a download for the creator", async ({
  page,
  browser,
}) => {
  const user = await createConfirmedUser("e2e-sec-upload");
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    const respondent = await browser.newContext();
    const r = await respondent.newPage();
    await r.goto(liveLink);
    await r
      .locator('input[type="file"]')
      .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
    await expect(r.getByText("Uploaded", { exact: true })).toBeVisible();
    await r.getByRole("button", { name: "Submit" }).click();
    await expect(r.getByText("Thanks!")).toBeVisible();
    await respondent.close();

    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}/responses`);
    await page
      .getByRole("link", { name: /Today|ago|AM|PM/ })
      .first()
      .click();
    const link = page.getByRole("link", { name: /logo\.png/ });
    const href = await link.getAttribute("href");
    expect(href).toContain("download=");
    const file = await page.request.get(href!);
    expect(file.headers()["content-disposition"]).toMatch(/^attachment/);
  } finally {
    await deleteUser(user.userId);
  }
});
