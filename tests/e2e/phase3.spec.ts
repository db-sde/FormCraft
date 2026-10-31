import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/**
 * Master spec Phase 3 through the running app: a response's PDF, set up
 * and downloaded; the embed SDK on another site (a popup that opens on a
 * delay, counted once); and pixels that wait for consent.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Workshop sign-up" },
  theme: {
    primaryColor: "#1d4ed8",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "You're in", isDefault: true }],
  logic: [],
  questions: [
    {
      id: "q_name",
      type: "short_text",
      order: 0,
      label: "Your name",
      required: true,
      settings: {},
    },
  ],
};

// The embed test serves a stand-in customer site through request
// interception, which Chromium treats as a public site; its Local Network
// Access checks would then block loading the SDK from localhost. Real
// sites load the SDK from the app's public address, where they don't apply.
test.use({
  launchOptions: {
    args: [
      "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests",
    ],
  },
});

test.describe("phase 3", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-phase3");
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("a registration PDF is set up, numbered and downloaded", async ({ page }) => {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    await page.goto(liveLink);
    await page.getByRole("textbox").fill("Grace Hopper");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "You're in" })).toBeVisible();

    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}/integrations`);
    await page
      .getByRole("button", { name: "Set up" })
      .nth(2) // summary, order, registration, certificate
      .click();
    await page.getByLabel("Number prefix").fill("REG-");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("On · Nobody (download only)")).toBeVisible();

    const { data: response } = await adminClient()
      .from("responses")
      .select("id")
      .eq("form_id", formId)
      .eq("status", "completed")
      .single();
    await page.goto(`/forms/${formId}/responses/${response!.id}`);
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: /Registration confirmation/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("registration-confirmation-REG-0001.pdf");
    // The number is fixed: shown next to the link from now on.
    await page.reload();
    await expect(page.getByText("REG-0001")).toBeVisible();

    // Someone outside the workspace can't fetch it.
    const outsider = await page.context().browser()!.newContext();
    const res = await outsider.request.get(
      `${new URL(page.url()).origin}/api/forms/${formId}/responses/${response!.id}/documents/registration`,
      { maxRedirects: 0 },
    );
    expect(res.headers()["content-type"] ?? "").not.toContain("application/pdf");
    await outsider.close();
  });

  test("the embed SDK opens a popup on another site and counts it once", async ({
    page,
    baseURL,
  }) => {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    const slug = liveLink.split("/").pop()!;
    const sdk = await page.request.get("/api/embed/sdk.js");
    expect(sdk.headers()["content-type"]).toContain("javascript");

    // A third-party page: a different origin from the app (127.0.0.1 vs
    // localhost). It stays on the loopback address because browsers won't
    // let a public site load from localhost (Private Network Access).
    const customer = `${baseURL!.replace("localhost", "127.0.0.1")}/__customer-site`;
    await page.route(customer, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><title>Shop</title><p>Welcome</p>
          <div data-formcraft="${slug}" data-mode="popup" data-trigger="delay:0" data-label="Sign up"></div>
          <script src="${baseURL}/api/embed/sdk.js" async></script>`,
      }),
    );
    await page.goto(customer);
    const dialog = page.getByRole("dialog", { name: "Sign up" });
    await expect(dialog).toBeVisible();
    await expect(
      page.frameLocator("iframe[data-formcraft-frame]").getByRole("textbox"),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // Reopen with the launcher: still one open counted for this page load.
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByRole("dialog", { name: "Sign up" })).toBeVisible();

    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from("analytics_events")
          .select("event_type")
          .eq("form_id", formId)
          .in("event_type", ["embed_impression", "embed_opened"]);
        return (data ?? []).map((e) => e.event_type).sort();
      })
      .toEqual(["embed_impression", "embed_opened"]);

    // A replayed beacon for the same page view isn't counted again.
    const { data: one } = await adminClient()
      .from("analytics_events")
      .select("session_id")
      .eq("form_id", formId)
      .eq("event_type", "embed_opened")
      .single();
    await page.request.post("/api/embed/events", {
      data: JSON.stringify({
        slug,
        event: "open",
        mode: "popup",
        trigger: "delay",
        pageview: one!.session_id,
      }),
      headers: { "content-type": "text/plain" },
    });
    const { count } = await adminClient()
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("form_id", formId)
      .eq("event_type", "embed_opened");
    expect(count).toBe(1);
  });

  test("pixels wait for consent, and declining loads none", async ({ page }) => {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    const admin = adminClient();
    const { data: form } = await admin
      .from("forms")
      .update({
        meta_pixel_id: "1234567890",
        tiktok_pixel_id: "C4ABCDEFGHIJKLMNOPQR",
        pixel_consent: "ask",
      })
      .eq("id", formId)
      .select("workspace_id")
      .single();
    await admin
      .from("workspaces")
      .update({ plan_id: "business" })
      .eq("id", form!.workspace_id);
    await page.route(/connect\.facebook\.net|analytics\.tiktok\.com/, (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.__vendor=(window.__vendor||0)+1;",
      }),
    );

    await page.goto(liveLink);
    await page.getByRole("button", { name: "No thanks" }).click();
    await page.reload();
    await expect(page.getByRole("dialog", { name: "Cookies on this form" })).toHaveCount(
      0,
    );
    expect(await page.evaluate(() => typeof (window as { fbq?: unknown }).fbq)).toBe(
      "undefined",
    );

    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole("button", { name: "Allow" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as { __vendor?: number }).__vendor ?? 0))
      .toBeGreaterThan(0);
  });
});
