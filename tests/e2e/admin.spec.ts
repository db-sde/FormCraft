import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, createConfirmedUser, deleteUser } from "./helpers";
import { totp } from "../totp";
import { ADMIN_PAGE_ROUTES } from "./routes";

/**
 * The Super Admin portal (Phase 0) against an admin build
 * (ADMIN_SURFACE=1, the `admin-3010` launch config). Set ADMIN_BASE_URL to
 * run it; the customer build's 404 for /admin is checked either way.
 */
const ADMIN = process.env.ADMIN_BASE_URL;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) =>
  execFileSync("psql", [DB_URL, "-tAq", "-v", "ON_ERROR_STOP=1", "-c", q], {
    encoding: "utf8",
  }).trim();

test("the customer app has no admin portal", async ({ request }) => {
  for (const path of ADMIN_PAGE_ROUTES) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(404);
  }
});

test.describe("Super Admin portal", () => {
  test.skip(!ADMIN, "set ADMIN_BASE_URL to an admin build");
  test.describe.configure({ mode: "serial" });

  let owner: Awaited<ReturnType<typeof createConfirmedUser>>;
  let newcomer: Awaited<ReturnType<typeof createConfirmedUser>>;
  let outsider: Awaited<ReturnType<typeof createConfirmedUser>>;

  test.beforeAll(async () => {
    sql("delete from private.change_requests; delete from private.staff_members;");
    owner = await createConfirmedUser("e2e-staff-owner");
    newcomer = await createConfirmedUser("e2e-staff-new");
    outsider = await createConfirmedUser("e2e-staff-out");
    const { error } = await adminClient().rpc("admin_bootstrap_owner", {
      p_user_id: owner.userId,
      p_display_name: "Olive Owner",
    });
    if (error) throw error;
  });

  test.afterAll(async () => {
    sql("delete from private.change_requests; delete from private.staff_members;");
    for (const u of [owner, newcomer, outsider]) if (u) await deleteUser(u.userId);
  });

  async function signIn(page: Page, user: { email: string; password: string }) {
    await page.goto(`${ADMIN}/admin`);
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByRole("heading", { name: "Set up your authenticator" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    const secret = (await page.locator("code").first().textContent())!.trim();
    await page.getByLabel("6-digit code").fill(totp(secret));
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
    const headers = (await page.request.get(`${ADMIN}/admin`)).headers();
    expect(headers["cache-control"]).toContain("no-store");
    expect(headers["x-robots-tag"]).toContain("noindex");

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
});
