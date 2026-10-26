import { test, expect, type Page } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/**
 * The ZAP scan of 26 Oct 2026: every page has a real Content-Security-
 * Policy (scripts only with this response's nonce), standard hardening
 * headers, and no framework banner — and nothing the app itself runs is
 * blocked by it, including a creator's analytics pixels.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Headers" },
  theme: {
    primaryColor: "#4f46e5",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks!", isDefault: true }],
  questions: [
    {
      id: "q1",
      type: "short_text",
      order: 0,
      label: "Your name",
      required: true,
      settings: {},
    },
  ],
  logic: [],
};

function policy(header: string | undefined) {
  return Object.fromEntries(
    (header ?? "")
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...values]) => [name, values]),
  );
}

/** CSP violations the page reports (blocked scripts, frames, requests). */
async function watchViolations(page: Page) {
  const violations: string[] = [];
  await page.exposeFunction("reportViolation", (v: string) => violations.push(v));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { reportViolation: (v: string) => void }).reportViolation(
        `${e.violatedDirective} ${e.blockedURI}`,
      );
    });
  });
  page.on("console", (msg) => {
    if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
  });
  return violations;
}

test("pages carry a nonce-based CSP and hardening headers", async ({ request }) => {
  const app = await request.get("/login");
  const headers = app.headers();
  expect(headers["x-powered-by"]).toBeUndefined();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");

  const csp = policy(headers["content-security-policy"]);
  expect(csp["default-src"]).toEqual(["'self'"]);
  expect(csp["script-src"]).toContain("'strict-dynamic'");
  expect(csp["script-src"].some((s: string) => s.startsWith("'nonce-"))).toBe(true);
  expect(csp["script-src"]).not.toContain("'unsafe-inline'");
  expect(csp["object-src"]).toEqual(["'none'"]);
  expect(csp["form-action"]).toEqual(["'self'"]);
  expect(csp["base-uri"]).toEqual(["'self'"]);
  expect(csp["frame-ancestors"]).toEqual(["'none'"]);

  // A fresh nonce on every response.
  const again = policy(
    (await request.get("/login")).headers()["content-security-policy"],
  );
  expect(again["script-src"]).not.toEqual(csp["script-src"]);

  const api = await request.get("/api/cron/health");
  expect(api.headers()["content-security-policy"]).toBe(
    "default-src 'none'; frame-ancestors 'none'",
  );
  expect(api.headers()["x-content-type-options"]).toBe("nosniff");
});

test("a published form runs, analytics pixels included, without a CSP violation", async ({
  page,
}) => {
  const user = await createConfirmedUser("e2e-csp");
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    const admin = adminClient();
    const { data: form } = await admin
      .from("forms")
      .update({
        ga_measurement_id: "G-TEST1234",
        gtm_container_id: "GTM-TEST123",
        meta_pixel_id: "1234567890",
      })
      .eq("id", formId)
      .select("workspace_id")
      .single();
    await admin
      .from("workspaces")
      .update({ plan_id: "business" })
      .eq("id", form!.workspace_id);

    // The vendors' scripts, stubbed: tests don't call Google or Meta.
    await page.route(/googletagmanager\.com|connect\.facebook\.net/, (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.__vendor=(window.__vendor||0)+1;",
      }),
    );
    const violations = await watchViolations(page);
    const response = await page.goto(liveLink);
    const csp = policy(response?.headers()["content-security-policy"]);
    // Forms are made to be embedded on any site.
    expect(csp["frame-ancestors"]).toEqual(["*"]);
    expect(response?.headers()["x-frame-options"]).toBeUndefined();

    await page.getByRole("textbox").fill("Ada");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Thanks!")).toBeVisible();
    // The pixels' own scripts ran (loaded by the nonce'd snippets).
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __vendor?: number }).__vendor ?? 0),
      )
      .toBeGreaterThan(0);
    expect(
      await page.evaluate(
        () => typeof (window as unknown as { formcraftTrack?: unknown }).formcraftTrack,
      ),
    ).toBe("function");
    expect(violations).toEqual([]);
  } finally {
    await deleteUser(user.userId);
  }
});

test("the signed-in app runs without a CSP violation", async ({ page }) => {
  const user = await createConfirmedUser("e2e-csp-app");
  try {
    const { formId } = await createPublishedForm(user, schema);
    const violations = await watchViolations(page);
    await loginViaUI(page, user.email, user.password);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    // The builder: the most script-heavy screen.
    await page.goto(`/forms/${formId}`);
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByRole("dialog").getByText("Your name")).toBeVisible();
    expect(violations).toEqual([]);
  } finally {
    await deleteUser(user.userId);
  }
});
