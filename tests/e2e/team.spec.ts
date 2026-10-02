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
 * Teams (P2.19) end to end: the owner invites a viewer from Settings →
 * Members (no email set up locally, so the link is shown to copy), the
 * viewer accepts in their own session, lands in the owner's workspace,
 * sees the forms but only the Responses side of them.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Team survey" },
  theme: {
    primaryColor: "#1f1f1f",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "q1",
      type: "short_text",
      order: 0,
      label: "Anything?",
      required: false,
      settings: {},
    },
  ],
  logic: [],
};

test("an owner invites a viewer, who sees responses but can't edit", async ({
  page,
  browser,
}) => {
  const owner = await createConfirmedUser("e2e-team-owner");
  const invitee = await createConfirmedUser("e2e-team-viewer");
  try {
    const { formId } = await createPublishedForm(owner, schema);
    await adminClient()
      .from("workspaces")
      .update({ plan_id: "business" })
      .eq("owner_id", owner.userId);

    await loginViaUI(page, owner.email, owner.password);
    await page.goto("/settings?tab=members");
    await page.getByLabel("Email").fill(invitee.email);
    await page.getByLabel("Role for the invitation").click();
    await page.getByRole("option", { name: "Viewer" }).click();
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    const link = await page
      .locator("span.font-mono", { hasText: "/invite/" })
      .textContent();
    expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
    // The invitations list is re-rendered by the server after the action.
    await expect(page.getByText(invitee.email.toLowerCase())).toBeVisible({
      timeout: 15_000,
    });

    const other = await browser.newContext();
    try {
      const viewer = await other.newPage();
      await loginViaUI(viewer, invitee.email, invitee.password);
      await viewer.goto(new URL(link!).pathname);
      await expect(viewer.getByRole("heading", { name: /^Join / })).toBeVisible();
      await viewer.getByRole("button", { name: "Accept invitation" }).click();
      await viewer.waitForURL("**/dashboard");
      await expect(viewer.getByRole("link", { name: "Team survey" })).toBeVisible();
      await expect(viewer.getByRole("button", { name: "New form" })).toHaveCount(0);

      // Opening the builder sends a viewer to the responses instead.
      await viewer.goto(`/forms/${formId}`);
      await viewer.waitForURL(`**/forms/${formId}/responses`);
      await expect(viewer.getByText("View only")).toBeVisible();
      await expect(viewer.getByRole("link", { name: "Build" })).toHaveCount(0);
      await viewer.goto(`/forms/${formId}/settings`);
      await viewer.waitForURL(`**/forms/${formId}/responses`);
    } finally {
      await other.close();
    }

    // The owner sees them as a viewer.
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: /Role for e2e-team-viewer/ }),
    ).toHaveText("Viewer");
  } finally {
    await adminClient().from("workspace_members").delete().eq("user_id", invitee.userId);
    await deleteUser(invitee.userId);
    await deleteUser(owner.userId);
  }
});
