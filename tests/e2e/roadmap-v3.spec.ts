import { expect, test, type Page } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/**
 * The four features the 20 November 2026 roadmap moved to Build Now:
 * link themes (#66), corrections to submitted answers (#55), video and
 * audio answers (#21) and email verification codes (#8).
 */
const theme = {
  primaryColor: "#1d4ed8",
  backgroundColor: "#ffffff",
  fontFamily: "inter",
  buttonStyle: "rounded",
} as const;

const stageBackground = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[style*="--st-bg"]');
    return el ? getComputedStyle(el).getPropertyValue("--st-bg").trim() : null;
  });

async function completedResponses(formId: string) {
  const { data } = await adminClient()
    .from("responses")
    .select("id")
    .eq("form_id", formId)
    .eq("status", "completed");
  return data ?? [];
}

test.describe("roadmap v3.1", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-v31");
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("#66: ?theme= picks a saved look; anything else gets the main one", async ({
    browser,
  }) => {
    const { liveLink } = await createPublishedForm(user, {
      schemaVersion: 1,
      meta: { title: "Themed" },
      theme,
      endings: [{ id: "end", title: "Thanks", isDefault: true }],
      questions: [
        {
          id: "q1",
          type: "short_text",
          order: 0,
          label: "Your name",
          required: false,
          settings: {},
        },
      ],
      logic: [],
      themeVariants: [
        {
          id: "dark",
          name: "Dark",
          theme: { ...theme, backgroundColor: "#111827", textColor: "#f9fafb" },
        },
      ],
    } as FormSchemaV1);
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${liveLink}?theme=dark`);
    await expect(page.getByRole("heading", { name: /Your name/ })).toBeVisible();
    expect(await stageBackground(page)).toBe("#111827");
    for (const other of ["light", "dark%3Bcolor%3Ared", "%3Cscript%3E"]) {
      await page.goto(`${liveLink}?theme=${other}`);
      await expect(page.getByRole("heading", { name: /Your name/ })).toBeVisible();
      expect(await stageBackground(page)).toBe("#ffffff");
    }
    await page.goto(`${liveLink}?embed=1&theme=dark`);
    await expect(page.getByRole("heading", { name: /Your name/ })).toBeVisible();
    expect(await stageBackground(page)).toBe("#111827");
    // The saved looks never reach the browser.
    expect(await page.content()).not.toContain("themeVariants");
  });

  test("#66: the Design panel saves the current look as a link theme", async ({
    page,
  }) => {
    const { formId } = await createPublishedForm(user, {
      schemaVersion: 1,
      meta: { title: "Looks" },
      theme,
      endings: [{ id: "end", title: "Thanks", isDefault: true }],
      questions: [
        {
          id: "q1",
          type: "short_text",
          order: 0,
          label: "Your name",
          required: false,
          settings: {},
        },
      ],
      logic: [],
    } as FormSchemaV1);
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}`);
    await page.getByRole("button", { name: "Design", exact: true }).click();
    await page.getByLabel("Link theme name").fill("Dark mode");
    await page.getByRole("button", { name: "Save this look" }).click();
    const list = page.getByRole("list", { name: "Link themes" });
    await expect(list.getByText("?theme=dark-mode")).toBeVisible();
    await expect(
      list.getByRole("button", { name: "Copy the link for Dark mode" }),
    ).toBeVisible();
    await expect(page.locator('[data-save-state="saved"]')).toBeVisible({
      timeout: 15000,
    });
    const { data } = await adminClient()
      .from("form_versions")
      .select("schema")
      .eq("form_id", formId)
      .eq("status", "draft")
      .single();
    expect((data!.schema as unknown as FormSchemaV1).themeVariants).toEqual([
      expect.objectContaining({ id: "dark-mode", name: "Dark mode" }),
    ]);
  });

  test("#55: an owner corrects a submitted answer with a reason; the original stays", async ({
    page,
  }) => {
    const { formId, liveLink } = await createPublishedForm(user, {
      schemaVersion: 1,
      meta: { title: "Corrections" },
      theme,
      endings: [{ id: "end", title: "Thanks", isDefault: true }],
      questions: [
        {
          id: "email",
          type: "email",
          order: 0,
          label: "Your email",
          required: true,
          settings: {},
        },
      ],
      logic: [],
    } as FormSchemaV1);
    const visitor = await page.context().browser()!.newContext();
    const form = await visitor.newPage();
    await form.goto(liveLink);
    await form.getByLabel("Your email").fill("ada@exmaple.com");
    await form.getByRole("button", { name: "Submit" }).click();
    await expect(form.getByRole("heading", { name: "Thanks" })).toBeVisible();
    await visitor.close();
    const [{ id: responseId }] = await completedResponses(formId);

    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}/responses/${responseId}`);
    await page
      .getByRole("button", { name: "Correct the answer to “Your email”" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Correct this answer" });
    await dialog.getByLabel("New answer").fill("ada@example.com");
    await dialog.getByLabel("Reason").fill("Respondent emailed about the typo");
    await dialog.getByRole("button", { name: "Save correction" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("ada@example.com", { exact: true })).toBeVisible();
    await page.getByText("Corrected once").click();
    await expect(page.getByText("ada@exmaple.com")).toBeVisible();
    await expect(page.getByText("“Respondent emailed about the typo”")).toBeVisible();
    await expect(page.getByText("Answer corrected").first()).toBeVisible();
    const { data: events } = await adminClient()
      .from("response_events")
      .select("kind")
      .eq("response_id", responseId)
      .eq("kind", "answer_edited");
    expect(events).toHaveLength(1);
    const { data: audit } = await adminClient()
      .from("audit_logs")
      .select("action, reason, outcome")
      .eq("target_id", responseId);
    expect(audit).toEqual([
      {
        action: "response.answer_corrected",
        reason: "Respondent emailed about the typo",
        outcome: "succeeded",
      },
    ]);
  });

  test("#8: a confirmed email needs the code sent to it", async ({ browser }) => {
    test.skip(!process.env.RESEND_BASE_URL, "needs the stand-in email server");
    const { formId, liveLink } = await createPublishedForm(user, {
      schemaVersion: 1,
      meta: { title: "Verified sign-up" },
      theme,
      endings: [{ id: "end", title: "Thanks", isDefault: true }],
      questions: [
        {
          id: "email",
          type: "email",
          order: 0,
          label: "Your email",
          required: true,
          settings: { verify: true },
        },
      ],
      logic: [],
    } as FormSchemaV1);
    const address = `code-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const page = await (await browser.newContext()).newPage();
    await page.goto(liveLink);
    await page.getByLabel("Your email").fill(address);
    // Not confirmed yet: it won't submit.
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("This question requires an answer.")).toBeVisible();

    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByText(`We sent a 6-digit code to ${address}.`)).toBeVisible();
    const sent = (await (await fetch(`${process.env.RESEND_BASE_URL}/sent`)).json()) as {
      to: string[];
      subject: string;
    }[];
    const mail = sent.reverse().find((m) => m.to.includes(address))!;
    const code = /^(\d{6}) is your code for Verified sign-up$/.exec(mail.subject)![1];

    await page.getByLabel("6-digit code").fill(code === "000000" ? "111111" : "000000");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText(/That code isn't right\. 4 tries left\./)).toBeVisible();
    await page.getByLabel("6-digit code").fill(code);
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Email confirmed")).toBeVisible();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("heading", { name: "Thanks" })).toBeVisible();
    expect(await completedResponses(formId)).toHaveLength(1);
  });
});
