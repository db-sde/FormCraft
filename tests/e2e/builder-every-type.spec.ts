import { test, expect, type Page } from "@playwright/test";
import {
  addQuestion,
  createConfirmedUser,
  deleteUser,
  loginViaUI,
  publishFromBuilder,
  startFromScratch,
  waitForSaved,
} from "./helpers";

/**
 * Every question type from the builder's menu, added through the UI to one
 * form — each must save — then the builder's side panels, then the
 * published form walked to its ending. No browser error and no failed
 * server request anywhere. (Booking needs a booking type first and has its
 * own specs.)
 */
const TYPES = [
  "Statement",
  "Short text",
  "Long text",
  "Email",
  "Phone",
  "Website URL",
  "Number",
  "Contact info",
  "Multiple choice",
  "Checkboxes",
  "Dropdown",
  "Yes / No",
  "Date",
  "Rating",
  "Opinion scale",
  "File upload",
  "Time",
  "Date & time",
  "Address",
  "Ranking",
  "Matrix",
  "Signature",
  "Products",
  "Picture choice",
  "Page break",
];

function watch(page: Page, problems: string[], who: string) {
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`${who} console: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) =>
    problems.push(`${who} page error: ${e.message.slice(0, 200)}`),
  );
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`${who} ${r.status()} ${r.url()}`);
  });
}

test("every question type can be added, saved, published and answered", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const problems: string[] = [];
  const user = await createConfirmedUser("e2e-every-type");
  try {
    watch(page, problems, "builder");
    await loginViaUI(page, user.email, user.password);
    await startFromScratch(page);

    for (const type of TYPES) {
      await addQuestion(page, type);
      await waitForSaved(page);
    }

    // New questions are required: switch that off on each, from its own
    // settings, so the walk below can step past the ones it can't answer.
    const items = page.getByRole("list", { name: "Questions" }).getByRole("button", {
      name: /^\d+ /,
    });
    const count = await items.count();
    for (let i = 0; i < count; i += 1) {
      await items.nth(i).click();
      const required = page.getByRole("switch", { name: /^Required/ });
      if ((await required.count()) && (await required.isChecked()))
        await required.click();
    }
    await waitForSaved(page);

    // The builder's side panels open without errors.
    for (const panel of ["Design", "Languages", "Logic"]) {
      await page.getByRole("button", { name: panel, exact: true }).click();
    }
    await page.keyboard.press("Escape");

    const liveLink = await publishFromBuilder(page);
    // Just published: nothing is waiting to be published.
    await page.waitForTimeout(3000);
    await expect(page.getByText("Unpublished changes")).toHaveCount(0);

    // Walk the published form to its ending, skipping what's optional.
    const visitor = await browser.newContext();
    const respondent = await visitor.newPage();
    watch(respondent, problems, "respondent");
    await respondent.goto(liveLink);
    await respondent.getByRole("button", { name: /Start/ }).click();
    let finished = false;
    const seen: string[] = [];
    for (let step = 0; step < 60 && !finished; step += 1) {
      seen.push(
        (await respondent
          .locator("h1, h2, legend")
          .first()
          .textContent()
          .catch(() => "?")) ?? "?",
      );
      const submit = respondent.getByRole("button", { name: "Submit", exact: true });
      if (await submit.isVisible().catch(() => false)) {
        await submit.click();
        finished = true;
        break;
      }
      // Fill whatever text fields this step shows (contact and address
      // parts are required by field).
      const fields = respondent.locator(
        "input:visible:not([type=radio]):not([type=checkbox]):not([type=file]):not([type=hidden]), textarea:visible",
      );
      for (let f = 0; f < (await fields.count()); f += 1) {
        const field = fields.nth(f);
        if (await field.inputValue().catch(() => "x")) continue;
        const type = (await field.getAttribute("type")) ?? "text";
        const value =
          {
            email: "walk@example.com",
            tel: "+14155550123",
            url: "https://example.com",
            number: "3",
            date: "2026-12-01",
            time: "10:30",
            "datetime-local": "2026-12-01T10:30",
          }[type] ?? "An answer";
        await field.fill(value).catch(() => undefined);
      }
      const next = respondent
        .getByRole("button", { name: /^(OK|Continue|Next|Skip)\b/ })
        .first();
      if (!(await next.isVisible().catch(() => false))) {
        seen.push(
          `STUCK: ${(await respondent.locator("body").innerText()).slice(0, 300)}`,
        );
        break;
      }
      await next.click({ timeout: 10_000 });
      await respondent.waitForTimeout(250);
    }
    expect(finished, `reached the Submit button; steps: ${seen.join(" | ")}`).toBe(true);
    await expect(
      respondent.getByRole("heading", { name: /Thank you|Thanks/ }).first(),
    ).toBeVisible();
    await visitor.close();

    expect(problems, problems.join("\n")).toEqual([]);
  } finally {
    await deleteUser(user.userId);
  }
});
