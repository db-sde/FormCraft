import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { totp } from "../totp";
import { ADMIN_PAGE_ROUTES } from "./routes";

/**
 * The Super Admin portal (Phase 0) against an admin build
 * (ADMIN_SURFACE=1, the `admin-3010` launch config). Set ADMIN_BASE_URL to
 * run it; the customer build's 404 for /admin is checked either way.
 */
const ADMIN = process.env.ADMIN_BASE_URL;
/** Set when ADMIN_BASE_URL is the customer app with ADMIN_SURFACE=shared. */
const SHARED = process.env.ADMIN_SHARED === "1";
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) =>
  execFileSync("psql", [DB_URL, "-tAq", "-v", "ON_ERROR_STOP=1", "-c", q], {
    encoding: "utf8",
  }).trim();

test("the customer app has no admin portal", async ({ request }) => {
  test.skip(SHARED, "this run's app serves the portal on purpose");
  for (const path of ADMIN_PAGE_ROUTES) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(404);
  }
});

test.describe("portal shared with the app (ADMIN_SURFACE=shared)", () => {
  test.skip(!SHARED, "set ADMIN_SHARED=1 and ADMIN_BASE_URL to such an app");

  test("serves /admin on the app's host, and the app as before", async ({ request }) => {
    const login = await request.get(`${ADMIN}/admin`);
    expect(login.status()).toBe(200);
    expect(login.url()).toMatch(/\/admin\/login$/);
    expect(login.headers()["cache-control"]).toContain("no-store");
    expect(login.headers()["x-robots-tag"]).toContain("noindex");
    expect(login.headers()["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    // The rest of the site isn't the portal: no redirect to /admin.
    const home = await request.get(`${ADMIN}/`, { maxRedirects: 0 });
    expect(home.status()).toBe(200);
    expect(await home.text()).not.toContain("FormCraft staff");
    expect((await request.get(`${ADMIN}/pricing`, { maxRedirects: 0 })).status()).toBe(
      200,
    );
  });

  test("never serves the portal on a custom domain", async ({ request }) => {
    const res = await request.get(`${ADMIN}/admin/login`, {
      headers: { host: "forms.customer-example.test" },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(404);
  });
});

test.describe("Super Admin portal", () => {
  test.skip(!ADMIN, "set ADMIN_BASE_URL to an admin build");
  test.describe.configure({ mode: "serial" });

  let owner: Awaited<ReturnType<typeof createConfirmedUser>>;
  let newcomer: Awaited<ReturnType<typeof createConfirmedUser>>;
  let outsider: Awaited<ReturnType<typeof createConfirmedUser>>;
  let customer: Awaited<ReturnType<typeof createConfirmedUser>>;
  let customerForm: { formId: string; liveLink: string };

  test.beforeAll(async () => {
    sql(
      "delete from private.restore_tests; delete from private.ops_drills; delete from private.access_reviews; delete from private.messages; delete from private.privacy_requests; delete from private.change_requests; delete from private.staff_members;",
    );
    owner = await createConfirmedUser("e2e-staff-owner");
    newcomer = await createConfirmedUser("e2e-staff-new");
    outsider = await createConfirmedUser("e2e-staff-out");
    customer = await createConfirmedUser("e2e-staff-cust");
    customerForm = await createPublishedForm(customer, {
      schemaVersion: 1,
      meta: { title: "Customer survey" },
      theme: {},
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
    } as unknown as FormSchemaV1);
    const { error } = await adminClient().rpc("admin_bootstrap_owner", {
      p_user_id: owner.userId,
      p_display_name: "Olive Owner",
    });
    if (error) throw error;
  });

  test.afterAll(async () => {
    sql(
      "delete from private.restore_tests; delete from private.ops_drills; delete from private.access_reviews; delete from private.messages; delete from private.privacy_requests; delete from private.change_requests; delete from private.staff_members;",
    );
    for (const u of [owner, newcomer, outsider, customer])
      if (u) await deleteUser(u.userId);
  });

  /** Authenticator secrets by email, from each account's first set-up. */
  const secrets = new Map<string, string>();

  async function signIn(page: Page, user: { email: string; password: string }) {
    await page.goto(`${ADMIN}/admin`);
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Continue" }).click();
    const known = secrets.get(user.email);
    if (known) {
      await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
      // The next 30-second code: never one already used this window.
      await page.getByLabel("6-digit code").fill(totp(known, Date.now() + 30_000));
    } else {
      await expect(
        page.getByRole("heading", { name: "Set up your authenticator" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Set up authenticator" }).click();
      const secret = (await page.locator("code").first().textContent())!.trim();
      secrets.set(user.email, secret);
      await page.getByLabel("6-digit code").fill(totp(secret));
    }
    await page.getByRole("button", { name: "Continue" }).click();
  }

  test("only the owner's set-up reaches the portal; others see no access", async ({
    browser,
  }) => {
    const other = await (await browser.newContext()).newPage();
    await signIn(other, outsider);
    await expect(other.getByRole("heading", { name: "No staff access" })).toBeVisible();
    await other.context().close();
  });

  test("owner signs in, adds staff with a logged emergency approval, sees it in the trail", async ({
    page,
  }) => {
    await signIn(page, owner);
    await expect(page.getByRole("heading", { name: "Hello, Olive Owner" })).toBeVisible();
    // Permissions in plain words; no promise of screens that already exist.
    await expect(page.getByText("Look up customers and workspaces")).toBeVisible();
    await expect(page.getByText(/next phases/)).toHaveCount(0);
    const headers = (await page.request.get(`${ADMIN}/admin`)).headers();
    expect(headers["cache-control"]).toContain("no-store");
    expect(headers["x-robots-tag"]).toContain("noindex");
    // The portal loads and frames nothing but its own server.
    const csp = headers["content-security-policy"];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toMatch(/connect-src 'self'(;|$)/);
    // Session cookies are out of reach of page scripts on the admin
    // deployment. A portal shared with the app keeps them readable, as
    // the app's browser client needs them (surface.ts).
    const session = (await page.context().cookies()).filter((c) =>
      c.name.startsWith("sb-"),
    );
    expect(session.length).toBeGreaterThan(0);
    expect(session.every((c) => (SHARED || c.httpOnly) && c.sameSite === "Lax")).toBe(
      true,
    );

    await page.getByRole("link", { name: "Staff" }).click();
    await page.getByLabel("Their staff email").fill(newcomer.email);
    await page.getByLabel("Role", { exact: true }).selectOption("support");
    await page.getByLabel("Name", { exact: true }).fill("Sam Support");
    await page.getByLabel("Reason").fill("Hiring Sam for support, ticket 42");
    await page.getByRole("button", { name: "Request change" }).click();
    await expect(page.getByText("Requested.")).toBeVisible();

    await page.getByRole("link", { name: "Approvals" }).click();
    // Your own request can't be approved normally: only break-glass.
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Emergency approve…" }).click();
    await page.getByLabel("Emergency reason").fill("No second staff member exists yet");
    await page.getByRole("button", { name: "Approve as emergency" }).click();
    await page.getByRole("button", { name: "Apply now" }).click();
    await expect(page.getByRole("button", { name: "Apply now" })).toHaveCount(0);

    await page.getByRole("link", { name: "Staff" }).click();
    await expect(page.getByRole("cell", { name: "Sam Support" })).toBeVisible();

    await page.getByRole("link", { name: "Audit trail" }).click();
    await expect(page.getByText(/Intact: \d+ entries/)).toBeVisible();
    await expect(
      page.getByText("change.emergency_approved", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("staff.add").first()).toBeVisible();
  });

  test("finds a customer, suspends them with an approval, and the customer sees it", async ({
    page,
    browser,
  }) => {
    await signIn(page, owner);
    await page.getByRole("link", { name: "Customers" }).click();
    await page.getByLabel("Search customers").fill(customer.email);
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("link", { name: "E2E workspace" }).click();
    await expect(page.getByText(customer.email)).toBeVisible();

    await page.getByLabel("New status").selectOption("suspended");
    await page
      .getByLabel("Message the customer sees (optional)")
      .fill("Please contact billing.");
    await page.getByLabel("Internal reason").fill("Chargeback on the last invoice");
    await page.getByRole("button", { name: "Request status change" }).click();
    await expect(page.getByText("Requested.")).toBeVisible();

    await page.getByRole("link", { name: "Approvals" }).click();
    await page.getByRole("button", { name: "Emergency approve…" }).click();
    await page.getByLabel("Emergency reason").fill("No second staff member in this test");
    await page.getByRole("button", { name: "Approve as emergency" }).click();
    await page.getByRole("button", { name: "Apply now" }).click();
    await expect(page.getByRole("button", { name: "Apply now" })).toHaveCount(0);

    // The respondent finds the form closed…
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto(customerForm.liveLink);
    await expect(visitor.getByText("This form isn't available right now.")).toBeVisible();
    // …and the customer sees why on their dashboard.
    await loginViaUI(visitor, customer.email, customer.password);
    await expect(
      visitor.getByText(/FormCraft has suspended this workspace/),
    ).toBeVisible();
    await expect(
      visitor.getByText("Please contact billing.", { exact: false }),
    ).toBeVisible();
    await visitor.context().close();
  });

  test("usage, the form inventory and operations; a restore drill is recorded", async ({
    page,
  }) => {
    await signIn(page, owner);
    await page.getByRole("link", { name: "Usage" }).click();
    await expect(page.getByRole("heading", { name: "Usage" })).toBeVisible();
    await expect(page.getByText(/Submissions/).first()).toBeVisible();
    await expect(page.getByText("Feature adoption (workspaces)")).toBeVisible();

    await page
      .getByRole("navigation", { name: "Staff" })
      .getByRole("link", { name: "Forms", exact: true })
      .click();
    await page.getByLabel("Search forms").fill("Customer survey");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByRole("cell", { name: /Customer survey/ })).toBeVisible();

    await page.getByRole("link", { name: "Operations" }).click();
    await expect(page.getByRole("heading", { name: "Open alerts" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Scheduler" })).toBeVisible();
    await page.getByLabel("Restored into").fill("Spare project for the drill");
    await page.getByLabel("What was checked").fill("Row counts match and a form opens");
    await page.getByRole("button", { name: "Record drill" }).click();
    await expect(page.getByText("Restore drill recorded.")).toBeVisible();
    await expect(page.getByText(/worked · Spare project for the drill/)).toBeVisible();
  });

  test("AI: spend and settings; a change goes through an approval", async ({ page }) => {
    await signIn(page, owner);
    await page
      .getByRole("navigation", { name: "Staff" })
      .getByRole("link", { name: "AI", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "AI", exact: true })).toBeVisible();
    await expect(page.getByText("Spent today (UTC)")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Review a form" })).toBeVisible();
    // Pausing is covered by the integration tests: other browser tests need AI on.
    await expect(page.getByRole("button", { name: "Pause AI" })).toBeVisible();

    // The code already asks for 4000 here, so this changes nothing for other tests.
    await page.getByLabel("Setting for").selectOption("form_review");
    await page.getByLabel(/Max output tokens/).fill("4000");
    await page.locator("#ai-reason").fill("Keep reviews short");
    await page.getByRole("button", { name: "Request change" }).click();
    await expect(page.getByText("Requested.")).toBeVisible();

    await page.getByRole("link", { name: "Approvals" }).click();
    await expect(page.getByText("Change AI settings").first()).toBeVisible();
    await page.getByRole("button", { name: "Emergency approve…" }).first().click();
    await page.getByLabel("Emergency reason").fill("No second staff member in this test");
    await page.getByRole("button", { name: "Approve as emergency" }).click();
    await page.getByRole("button", { name: "Apply now" }).click();
    await expect(page.getByRole("button", { name: "Apply now" })).toHaveCount(0);

    await page
      .getByRole("navigation", { name: "Staff" })
      .getByRole("link", { name: "AI", exact: true })
      .click();
    await expect(
      page
        .getByRole("row", { name: /Review a form/ })
        .getByRole("cell", { name: "4000" }),
    ).toBeVisible();
  });

  test("privacy: a request is logged, checked, searched and closed; a notice is drafted", async ({
    page,
  }) => {
    await signIn(page, owner);
    const nav = page.getByRole("navigation", { name: "Staff" });
    await nav.getByRole("link", { name: "Privacy", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Privacy", exact: true }),
    ).toBeVisible();
    await page.getByLabel("The person asks to").selectOption("access");
    await page.getByLabel("Their email address").fill(customer.email);
    await page.getByRole("button", { name: "Log request" }).click();
    await expect(page).toHaveURL(/\/admin\/privacy\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Not checked yet")).toBeVisible();

    await page.getByLabel("How you checked").fill("Replied from the address");
    await page.getByRole("button", { name: "Record identity check" }).click();
    await expect(page.getByText(/Checked .*Replied from the address/)).toBeVisible();
    await page.getByRole("button", { name: "Find their data" }).click();
    // A creator, not a respondent: no responses, but an account.
    await expect(page.getByText(/0 response\(s\) and 0 booking\(s\)/)).toBeVisible();
    await expect(page.getByText(/They also have a FormCraft account/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Download their data (JSON)" }),
    ).toBeVisible();

    await page
      .getByLabel("What was done, or why it was refused")
      .fill("Nothing held beyond the account");
    await page.getByRole("button", { name: "Close request" }).click();
    await expect(page.getByText("Outcome:")).toBeVisible();

    await nav.getByRole("link", { name: "Notices", exact: true }).click();
    await page.getByLabel("Kind").selectOption("incident");
    await page.getByLabel("Subject").fill("Short delay to webhooks");
    await page
      .getByLabel("Message (plain text)")
      .fill("Some webhooks were delayed this morning. All were delivered.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText(/Saved\. It would reach \d+ owner/)).toBeVisible();
    await page
      .getByLabel("Why it needs sending")
      .first()
      .fill("Tell customers about the delay");
    await page.getByRole("button", { name: "Ask to send" }).first().click();
    await expect(page.getByText("Waiting for approval").first()).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).first().click();
    await expect(page.getByText("Cancelled").first()).toBeVisible();
  });

  test("hardening: the monthly access review and an outage drill are recorded", async ({
    page,
  }) => {
    await signIn(page, owner);
    const nav = page.getByRole("navigation", { name: "Staff" });
    await nav.getByRole("link", { name: "Staff", exact: true }).click();
    await page.getByRole("link", { name: "Access review" }).click();
    await expect(page.getByRole("heading", { name: "Access review" })).toBeVisible();
    // Every active staff member must be ticked.
    const boxes = page.getByRole("checkbox");
    await boxes.first().check();
    if ((await boxes.count()) > 1) {
      await page.getByRole("button", { name: "Record review" }).click();
      await expect(page.getByText(/Tick every active staff member/)).toBeVisible();
    }
    for (const box of await boxes.all()) await box.check();
    await page.getByLabel(/Notes/).fill("Everyone still needs their role");
    await page.getByRole("button", { name: "Record review" }).click();
    await expect(page.getByText("Access review recorded.")).toBeVisible();
    await expect(page.getByText(/Last reviewed .* by Olive Owner/)).toBeVisible();

    await nav.getByRole("link", { name: "Operations", exact: true }).click();
    await page.getByLabel("Drill", { exact: true }).selectOption("email_outage");
    await page
      .getByLabel("What was tried")
      .fill("Pointed email at a dead provider for 10 minutes");
    await page
      .getByLabel("What happened")
      .fill("Notices queued, then sent once when it came back");
    await page.getByRole("button", { name: "Record this drill" }).click();
    await expect(page.getByText("Drill recorded.")).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Email provider down" }),
    ).toBeVisible();
  });
});
