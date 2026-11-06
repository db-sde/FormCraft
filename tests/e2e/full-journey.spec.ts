import { test, expect, devices, type Page } from "@playwright/test";
import {
  addQuestion,
  adminClient,
  createConfirmedUser,
  deleteUser,
  loginViaUI,
  publishFromBuilder,
  startFromScratch,
  waitForSaved,
} from "./helpers";

/**
 * One whole journey across the three roles, through the UI only:
 *
 * - a creator builds a form in the builder (renames it, adds a choice and
 *   a rating question, edits their wording and options) and publishes it;
 * - two respondents fill it — one on a desktop, one on a phone;
 * - the creator reviews: the responses list, one record (status,
 *   comment), and the CSV export;
 * - a teammate invited as a viewer reads the responses but can't edit.
 *
 * Every page along the way must load without a browser error or a failed
 * server request.
 */

/** Collects console errors and 5xx responses for a page. */
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

async function respond(
  page: Page,
  plan: string,
  stars: number,
  name: string,
  email: string,
) {
  await page.getByRole("button", { name: /Start/ }).click();
  await page.getByRole("radio", { name: new RegExp(plan) }).click();
  await page.getByRole("radio", { name: new RegExp(`^${stars} `) }).click();
  await page.getByRole("textbox").fill(`${name} needs onboarding for 12 people.`);
  await page.keyboard.press("Enter");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "OK" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.getByLabel("Phone")).toBeVisible();
  await page.getByRole("button", { name: "OK" }).click();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Thank you!")).toBeVisible();
}

test("creator builds and publishes, respondents fill it on desktop and phone, the team reviews", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const problems: string[] = [];
  const creator = await createConfirmedUser("e2e-journey");
  const teammate = await createConfirmedUser("e2e-journey-viewer");
  try {
    // --- Creator: build and publish -------------------------------------
    watch(page, problems, "creator");
    await loginViaUI(page, creator.email, creator.password);
    await startFromScratch(page);
    const formId = page.url().split("/forms/")[1];

    await page.getByLabel("Form name").fill("Customer onboarding");
    await page.getByLabel("Form name").press("Enter");

    await addQuestion(page, "Multiple choice");
    await page.getByLabel("Question text").fill("Which plan are you on?");
    await page.getByLabel("Option 1", { exact: true }).fill("Starter");
    await page.getByLabel("Option 2", { exact: true }).fill("Pro");
    await page.getByRole("button", { name: "Add option" }).click();
    await page.getByLabel("Option 3", { exact: true }).fill("Enterprise");

    await addQuestion(page, "Rating");
    await page.getByLabel("Question text").fill("How was signing up?");
    await waitForSaved(page);

    const liveLink = await publishFromBuilder(page);
    const { data: published } = await adminClient()
      .from("forms")
      .select("title, slug")
      .eq("id", formId)
      .single();
    expect(published?.title).toBe("Customer onboarding");

    // --- Respondents: desktop, then phone -------------------------------
    const desk = await browser.newContext();
    const deskPage = await desk.newPage();
    watch(deskPage, problems, "desktop respondent");
    await deskPage.goto(liveLink);
    await expect(
      deskPage.getByRole("heading", { name: /Customer onboarding|Welcome/ }).first(),
    ).toBeVisible();
    await respond(deskPage, "Pro", 4, "Grace Hopper", "grace@example.com");
    await desk.close();

    const phone = await browser.newContext({ ...devices["Pixel 7"] });
    const phonePage = await phone.newPage();
    watch(phonePage, problems, "phone respondent");
    await phonePage.goto(liveLink);
    await respond(phonePage, "Enterprise", 5, "Alan Turing", "alan@example.com");
    await phone.close();

    // --- Creator: review ------------------------------------------------
    await page.goto(`/forms/${formId}/responses`);
    await expect(page.getByText("2 responses", { exact: true })).toBeVisible();
    const { data: rows } = await adminClient()
      .from("responses")
      .select("id, status")
      .eq("form_id", formId)
      .eq("status", "completed");
    expect(rows).toHaveLength(2);

    await page.goto(`/forms/${formId}/responses/${rows![0].id}`);
    await expect(page.getByText("Which plan are you on?")).toBeVisible();
    const timeline = page.getByRole("region", { name: "Timeline" });
    await expect(timeline.getByText("Submitted")).toBeVisible();
    await page.getByLabel("Status").click();
    await page.getByRole("option", { name: "In progress" }).click();
    await expect(timeline.getByText("Status set to In progress")).toBeVisible();
    await page.getByLabel("Add a comment").fill("Book the kickoff call.");
    await page.getByRole("button", { name: "Comment" }).click();
    await expect(
      page
        .getByRole("region", { name: "Internal comments" })
        .getByText("Book the kickoff call."),
    ).toBeVisible();

    const csv = await page.request.get(`/api/forms/${formId}/export.csv`);
    expect(csv.status()).toBe(200);
    const text = await csv.text();
    expect(text).toContain("Which plan are you on?");
    expect(text).toContain("Pro");
    expect(text).toContain("Enterprise");
    expect(text).toContain("grace@example.com");

    // The leads list has both people.
    await page.goto("/leads");
    await expect(page.getByRole("cell", { name: "Grace Hopper" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Alan Turing" })).toBeVisible();

    // --- Teammate: a viewer reads, can't edit ---------------------------
    await adminClient()
      .from("workspaces")
      .update({ plan_id: "business" })
      .eq("owner_id", creator.userId);
    await page.goto("/settings?tab=members");
    await page.getByLabel("Email").fill(teammate.email);
    await page.getByLabel("Role for the invitation").click();
    await page.getByRole("option", { name: "Viewer" }).click();
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    const link = await page
      .locator("span.font-mono", { hasText: "/invite/" })
      .textContent();

    const other = await browser.newContext();
    try {
      const viewer = await other.newPage();
      watch(viewer, problems, "viewer");
      await loginViaUI(viewer, teammate.email, teammate.password);
      await viewer.goto(new URL(link!).pathname);
      await viewer.getByRole("button", { name: "Accept invitation" }).click();
      await viewer.waitForURL("**/dashboard");
      await viewer.goto(`/forms/${formId}/responses`);
      await expect(viewer.getByText("2 responses", { exact: true })).toBeVisible();
      await expect(viewer.getByText("View only")).toBeVisible();
      await viewer.goto(`/forms/${formId}/responses/${rows![0].id}`);
      await expect(viewer.getByText("Which plan are you on?")).toBeVisible();
      await expect(viewer.getByLabel("Add a comment")).toHaveCount(0);
      // A viewer can't reach the builder.
      await viewer.goto(`/forms/${formId}`);
      await viewer.waitForURL(`**/forms/${formId}/responses`);
    } finally {
      await other.close();
    }

    expect(problems, problems.join("\n")).toEqual([]);
  } finally {
    await adminClient().from("workspace_members").delete().eq("user_id", teammate.userId);
    await deleteUser(teammate.userId);
    await deleteUser(creator.userId);
  }
});
