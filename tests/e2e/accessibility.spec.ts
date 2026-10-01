import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/**
 * Automated accessibility checks (axe-core, WCAG 2.0/2.1 A + AA) over
 * the pages people actually use. Only "serious" and "critical" findings
 * fail the build — they are the ones that lock someone out (unlabelled
 * controls, unreadable contrast, broken landmarks); lesser findings are
 * printed in the test output so they stay visible. This catches the
 * mechanical half of accessibility; keyboard-only use is covered by
 * keyboard-journeys.spec.ts, and neither replaces a human with a
 * screen reader.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Accessible form" },
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
      id: "q_pick",
      type: "single_select",
      order: 1,
      label: "Pick one",
      required: false,
      settings: {
        allowOther: false,
        options: [
          { id: "a", label: "Option A" },
          { id: "b", label: "Option B" },
        ],
      },
    },
  ],
  logic: [],
};

async function audit(page: Page, name: string) {
  // Let entrance animations (e.g. a question fading in) finish first:
  // axe measures contrast through opacity, so a half-faded heading would
  // read as low contrast. Endless ones (spinners) are ignored.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity,
      ),
  );
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const describe = (v: (typeof results.violations)[number]) =>
    `${v.id} (${v.impact}): ${v.help} — ${v.nodes
      .slice(0, 3)
      .map((n) => n.target.join(" "))
      .join(" | ")}`;

  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  const minor = results.violations.filter((v) => !blocking.includes(v));
  if (minor.length > 0) {
    console.log(`a11y notes for ${name}:\n  ${minor.map(describe).join("\n  ")}`);
  }
  expect(blocking.map(describe), `${name} has accessibility problems`).toEqual([]);
}

test.describe("accessibility", () => {
  test.setTimeout(120_000);

  test("signed-out pages", async ({ page }) => {
    for (const path of ["/", "/login", "/signup", "/forgot-password"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await audit(page, path);
    }
  });

  test("the public form, on each kind of step", async ({ page }) => {
    const user = await createConfirmedUser("e2e-a11y-form");
    try {
      const { liveLink } = await createPublishedForm(user, schema);
      await page.goto(liveLink);
      await expect(page.getByLabel("Name")).toBeVisible();
      await audit(page, "public form: contact step");

      await page.getByLabel("Name").fill("Ada");
      await page.getByLabel("Email").fill("ada@example.com");
      await page.getByRole("button", { name: "OK" }).click();
      await expect(page.getByText("Pick one")).toBeVisible();
      await audit(page, "public form: choice step");
    } finally {
      await deleteUser(user.userId);
    }
  });

  test("the creator's pages", async ({ page }) => {
    const user = await createConfirmedUser("e2e-a11y");
    try {
      const { formId } = await createPublishedForm(user, schema);
      await loginViaUI(page, user.email, user.password);
      for (const path of [
        "/dashboard",
        "/templates",
        "/leads",
        "/settings",
        `/forms/${formId}`,
        `/forms/${formId}/share`,
        `/forms/${formId}/responses`,
        `/forms/${formId}/integrations`,
        `/forms/${formId}/settings`,
      ]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await audit(page, path);
      }
    } finally {
      await deleteUser(user.userId);
    }
  });
});
