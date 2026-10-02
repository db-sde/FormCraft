import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { assignArm, VISITOR_COOKIE } from "@/domains/experiments";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
} from "./helpers";

/** A/B tests (P3.9) over HTTP: the proxy gives a visitor an id, the
 * shared link serves each visitor the same arm every time, and a
 * response from version B is tagged with the test. */
const schema = (title: string): FormSchemaV1 => ({
  schemaVersion: 1,
  meta: { title },
  theme: {
    primaryColor: "#1f1f1f",
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
      label: title,
      required: true,
      settings: {},
    },
  ],
  logic: [],
});

test("a split link serves each visitor one arm, and tags B's responses", async ({
  page,
  context,
  baseURL,
}) => {
  const user = await createConfirmedUser("e2e-ab");
  try {
    const a = await createPublishedForm(user, schema("Version Alpha"));
    const b = await createPublishedForm(user, schema("Version Beta"));
    const admin = adminClient();
    const { data: form } = await admin
      .from("forms")
      .select("workspace_id")
      .eq("id", a.formId)
      .single();
    await admin
      .from("workspaces")
      .update({ plan_id: "business" })
      .eq("id", form!.workspace_id);
    const { data: experiment } = await admin
      .from("experiments")
      .insert({
        workspace_id: form!.workspace_id,
        form_id: a.formId,
        variant_form_id: b.formId,
        name: "E2E",
        split: 50,
      })
      .select("id")
      .single();

    // A first visit gets a visitor cookie, and the arm that id maps to.
    await page.goto(a.liveLink);
    const cookie = (await context.cookies()).find((c) => c.name === VISITOR_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    const first = assignArm(experiment!.id, cookie!.value, 50);
    const expected = first === "b" ? "Version Beta" : "Version Alpha";
    await expect(page.getByRole("heading", { name: expected })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: expected })).toBeVisible();

    // A visitor whose id maps to B gets B on A's link.
    let visitor = "";
    for (let i = 0; !visitor; i++) {
      const candidate = `e2e-visitor-${i}-0000000000`;
      if (assignArm(experiment!.id, candidate, 50) === "b") visitor = candidate;
    }
    await context.clearCookies();
    await context.addCookies([{ name: VISITOR_COOKIE, value: visitor, url: baseURL! }]);
    await page.goto(a.liveLink);
    await expect(page.getByRole("heading", { name: "Version Beta" })).toBeVisible();
    await page.getByRole("textbox").fill("Ada");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("heading", { name: "Thanks!" })).toBeVisible();
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("responses")
          .select("experiment_id")
          .eq("form_id", b.formId)
          .eq("status", "completed")
          .maybeSingle();
        return data?.experiment_id;
      })
      .toBe(experiment!.id);
  } finally {
    await deleteUser(user.userId);
  }
});
