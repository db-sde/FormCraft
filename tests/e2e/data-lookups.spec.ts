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
 * External data during a response (logic spec phase 24) in the browser.
 * The test server runs in production mode, where a lookup can't call a
 * local address (by design), so the browser's lookup request is answered
 * here — storing the values on the response as the server does. The
 * server's own call is covered by tests/integration/data-lookups.test.ts.
 */
const schema = {
  schemaVersion: 1,
  meta: { title: "Qualify" },
  theme: {
    primaryColor: "#1f1f1f",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [
    { id: "small", title: "Start for free", isDefault: true },
    { id: "big", title: "Let's talk" },
  ],
  hiddenFields: [{ name: "company_size" }, { name: "company_name" }],
  questions: [
    {
      id: "mail",
      type: "email",
      order: 0,
      label: "Work email",
      required: true,
      settings: {},
    },
    {
      id: "goal",
      type: "short_text",
      order: 1,
      label: "What does {{company_name}} want to do?",
      required: true,
      settings: {},
    },
  ],
  logic: [],
  rules: [
    {
      id: "r_big",
      on: { event: "form_completed" },
      when: {
        type: "compare",
        left: { type: "hidden", name: "company_size" },
        op: "gt",
        right: { type: "literal", value: 100 },
      },
      then: [{ type: "jump_to_ending", endingId: "big" }],
    },
  ],
} as unknown as FormSchemaV1;

test("a lookup's values reach recall and the ending; the creator sets one up", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const user = await createConfirmedUser("e2e-lookup");
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    const admin = adminClient();
    const { data: form } = await admin
      .from("forms")
      .select("workspace_id")
      .eq("id", formId)
      .single();
    await admin
      .from("workspaces")
      .update({ plan_id: "business" })
      .eq("id", form!.workspace_id);

    // The creator adds the lookup on the Integrations page.
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}/integrations`);
    await page.getByRole("button", { name: "Add a lookup" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Company");
    await page
      .getByLabel("URL (GET, returns JSON)")
      .fill("http://10.0.0.1/x?e={{answer:mail}}");
    await page.getByLabel("Path in the reply 1").fill("company.employees");
    await page.getByRole("button", { name: "Add lookup" }).click();
    await expect(page.getByText("Lookup URLs must use HTTPS.")).toBeVisible();
    await page
      .getByLabel("URL (GET, returns JSON)")
      .fill("https://api.example.com/companies?e={{answer:mail}}");
    await page.getByLabel("Header (optional)").fill("Authorization");
    await page.getByLabel("Header value").fill("Bearer e2e-secret");
    await page.getByRole("button", { name: "Another field" }).click();
    await page.getByLabel("Path in the reply 2").fill("company.name");
    await page.getByRole("button", { name: "Add lookup" }).click();
    await expect(page.getByText("After 1 · Work email")).toBeVisible();
    await expect(page.getByText("e2e-secret")).toHaveCount(0);
    const { data: saved } = await admin
      .from("form_lookups")
      .select("trigger_question_id, outputs, encrypted_header")
      .eq("form_id", formId)
      .single();
    expect(saved?.trigger_question_id).toBe("mail");
    expect(saved?.outputs).toEqual([
      { field: "company_size", path: "company.employees" },
      { field: "company_name", path: "company.name" },
    ]);
    expect(JSON.stringify(saved?.encrypted_header)).not.toContain("e2e-secret");

    // A respondent: the lookup runs after the email, before the next step.
    await page.context().clearCookies();
    let asked: { questionId: string; answers: Record<string, unknown> } | null = null;
    await page.route("**/api/responses/*/lookup", async (route) => {
      asked = route.request().postDataJSON();
      const responseId = route.request().url().split("/").at(-2)!;
      const values = { company_size: "250", company_name: "Analytical Engines" };
      await admin
        .from("responses")
        .update({ hidden_fields: values })
        .eq("id", responseId);
      await route.fulfill({ json: { values } });
    });
    // A value for a looked-up field in the URL is ignored.
    await page.goto(`${liveLink}?company_name=Spoofed`);
    await page.getByRole("textbox").fill("ada@example.com");
    await page.getByRole("button", { name: "OK" }).click();
    await expect(
      page.getByRole("heading", { name: "What does Analytical Engines want to do?" }),
    ).toBeVisible();
    expect(asked).toMatchObject({
      questionId: "mail",
      answers: { mail: "ada@example.com" },
    });
    await page.getByRole("textbox").fill("Grow");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("heading", { name: "Let's talk" })).toBeVisible();
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("responses")
          .select("ending_id, status")
          .eq("form_id", formId)
          .maybeSingle();
        return data;
      })
      .toEqual({ ending_id: "big", status: "completed" });
  } finally {
    await deleteUser(user.userId);
  }
});
