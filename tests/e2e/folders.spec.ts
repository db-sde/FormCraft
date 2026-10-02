import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/** Folders (P2.20): make one, file a form in it, filter by it, delete
 * it — and the form is still there. */
const schema = (title: string): FormSchemaV1 => ({
  schemaVersion: 1,
  meta: { title },
  theme: {
    primaryColor: "#1f1f1f",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    { id: "q1", type: "short_text", order: 0, label: "Q", required: false, settings: {} },
  ],
  logic: [],
});

test("forms can be filed in folders, and deleting a folder keeps its forms", async ({
  page,
}) => {
  const user = await createConfirmedUser("e2e-folders");
  try {
    await createPublishedForm(user, schema("Alpha form"));
    await createPublishedForm(user, schema("Beta form"));
    await loginViaUI(page, user.email, user.password);

    const folders = page.getByRole("navigation", { name: "Folders" });
    await folders.getByRole("button", { name: "New folder" }).click();
    await page.getByLabel("New folder name").fill("Clients");
    await page.keyboard.press("Enter");
    await expect(folders.getByRole("button", { name: /Clients 0/ })).toBeVisible();

    await folders.getByRole("button", { name: /All folders/ }).click();
    await page.getByRole("button", { name: 'Actions for "Alpha form"' }).first().click();
    await page.getByRole("menuitem", { name: "Move to folder" }).click();
    await page.getByRole("menuitem", { name: "Clients" }).click();
    await expect(page.getByText("Moved to Clients.")).toBeVisible();

    await folders.getByRole("button", { name: /Clients 1/ }).click();
    await expect(page.getByRole("link", { name: "Alpha form" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Beta form" })).toHaveCount(0);

    page.once("dialog", (dialog) => dialog.accept());
    await folders.getByRole("button", { name: "Clients folder options" }).click();
    await page.getByRole("menuitem", { name: "Delete folder" }).click();
    await expect(
      page.getByText("Folder deleted. Its forms are still here."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Alpha form" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Beta form" })).toBeVisible();
  } finally {
    await deleteUser(user.userId);
  }
});
