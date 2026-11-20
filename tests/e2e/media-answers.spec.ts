import { expect, test } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/**
 * Video and audio answers (roadmap #21), with Chromium's stand-in
 * microphone and camera (a tone and a test pattern), so no real device or
 * permission prompt is involved.
 */
test.use({
  permissions: ["microphone", "camera"],
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});

const theme = {
  primaryColor: "#1d4ed8",
  backgroundColor: "#ffffff",
  fontFamily: "inter",
  buttonStyle: "rounded",
} as const;

test.describe("#21: video and audio answers", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-v31m");
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("records audio after consent, plays it back, submits, and the team can play it", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "fake media devices are a Chromium flag");
    const { formId, liveLink } = await createPublishedForm(user, {
      schemaVersion: 1,
      meta: { title: "Voice note" },
      theme,
      endings: [{ id: "end", title: "Thanks", isDefault: true }],
      questions: [
        {
          id: "voice",
          type: "media",
          order: 0,
          label: "Tell us about your trip",
          required: true,
          settings: { kind: "audio", maxSeconds: 5 },
        },
      ],
      logic: [],
    } as FormSchemaV1);

    await page.goto(liveLink);
    const record = page.getByRole("button", { name: "Record audio" });
    await expect(record).toBeDisabled();
    await page
      .getByLabel("I agree to this recording being sent with my answers.")
      .check();
    await record.click();
    await expect(page.getByText(/Recording 0:0\d of 0:05/)).toBeVisible();
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(
      page.getByText("Recording saved. Play it back, or record again to replace it."),
    ).toBeVisible();
    await expect(page.getByLabel("Your recording")).toBeVisible();
    // Recording again replaces it: still one file.
    await page.getByRole("button", { name: "Record again" }).click();
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByText(/Recording saved/)).toBeVisible();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("heading", { name: "Thanks" })).toBeVisible();

    const [{ id: responseId }] = (
      await adminClient()
        .from("responses")
        .select("id")
        .eq("form_id", formId)
        .eq("status", "completed")
    ).data!;
    const { data: uploads } = await adminClient()
      .from("uploads")
      .select("mime_type, size_bytes")
      .eq("response_id", responseId);
    expect(uploads).toHaveLength(1);
    expect(uploads![0].mime_type).toMatch(/^audio\//);

    await page.context().clearCookies();
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}/responses/${responseId}`);
    await expect(page.locator("audio source")).toHaveAttribute("src", /^https?:\/\//);
    await expect(page.getByText(/^Recorded /)).toBeVisible();
  });
});
