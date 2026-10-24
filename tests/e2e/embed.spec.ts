import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { buildEmbedSnippet } from "@/domains/forms/embed";
import { createConfirmedUser, createPublishedForm, deleteUser } from "./helpers";

/**
 * QA FC-07: on a creator's own page, the standard embed takes the form's
 * height (shrinking as well as growing) and the frame shows the theme's
 * colour throughout, never the app's.
 */
const DARK = "#0f172a";
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Embedded" },
  theme: {
    primaryColor: "#f59e0b",
    backgroundColor: DARK,
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks!", isDefault: true }],
  questions: [
    {
      id: "q_one",
      type: "short_text",
      order: 0,
      label: "First",
      required: true,
      settings: {},
    },
    {
      id: "q_two",
      type: "multi_select",
      order: 1,
      label: "Pick any",
      required: false,
      settings: {
        allowOther: false,
        options: Array.from({ length: 12 }, (_, i) => ({
          id: `o${i}`,
          label: `Option ${i + 1}`,
        })),
      },
    },
  ],
  logic: [],
};

test("the standard embed fits the form and shows only the theme's colour", async ({
  page,
  baseURL,
}) => {
  const user = await createConfirmedUser("e2e-embed");
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    const snippet = buildEmbedSnippet({
      formUrl: new URL(liveLink, baseURL).toString(),
      formId,
      title: "Embedded",
    });
    // The creator's page (served on the app's origin: Chrome's local
    // network checks block other test origins from framing localhost).
    const host = new URL("/__embed-host", baseURL).toString();
    await page.route(host, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><body style="margin:0;background:#fff">${snippet}</body>`,
      }),
    );
    await page.goto(host);
    const iframe = page.locator(`iframe[data-formcraft="${formId}"]`);
    const frame = page.frameLocator(`iframe[data-formcraft="${formId}"]`);
    await expect(frame.getByText("First")).toBeVisible({ timeout: 15000 });

    const height = async () => (await iframe.boundingBox())?.height ?? 0;
    // The snippet starts the frame at 600px; a one-question step is shorter.
    await expect.poll(height).toBeLessThan(600);
    const short = await height();

    // The page inside the frame is the theme's colour, edge to edge.
    const bg = await frame
      .locator("body")
      .evaluate((b) => getComputedStyle(b).backgroundColor);
    expect(bg).toBe("rgb(15, 23, 42)");

    // A taller step grows the frame…
    await frame.getByRole("textbox").fill("hello");
    await frame.getByRole("button", { name: "OK" }).click();
    await expect(frame.getByText("Option 12")).toBeVisible();
    await expect.poll(height).toBeGreaterThan(short + 100);

    // …and going back shrinks it again.
    await frame.getByRole("button", { name: "Back" }).click();
    await expect(frame.getByText("First")).toBeVisible();
    await expect.poll(height).toBeLessThan(short + 20);
  } finally {
    await deleteUser(user.userId);
  }
});
