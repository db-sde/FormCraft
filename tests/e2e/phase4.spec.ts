import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import type { Json } from "@/lib/supabase/database.types";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/**
 * Master spec Phase 4 through the running app: an in-form variant served
 * to a visitor and kept on their response; the cross-tab and its CSV;
 * and a confidential form that shows only its report.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Team pulse" },
  theme: {
    primaryColor: "#1d4ed8",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks!", isDefault: true }],
  logic: [],
  questions: [
    {
      id: "q_team",
      type: "single_select",
      order: 0,
      label: "Which team are you on?",
      required: true,
      settings: {
        allowOther: false,
        options: [
          { id: "t_a", label: "Alpha" },
          { id: "t_b", label: "Beta" },
        ],
      },
    },
    {
      id: "q_nps",
      type: "opinion_scale",
      order: 1,
      label: "How likely are you to recommend working here?",
      required: true,
      settings: { min: 0, max: 10 },
    },
  ],
  variants: [
    {
      id: "v_b",
      name: "Casual",
      questions: { q_team: { label: "Who's your crew?" } },
    },
  ],
};

async function plan(userId: string) {
  const admin = adminClient();
  const { data: ws } = await admin
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId)
    .single();
  await admin.from("workspaces").update({ plan_id: "business" }).eq("id", ws!.id);
}

async function respond(formId: string, team: string, nps: number) {
  const admin = adminClient();
  const { data: version } = await admin
    .from("form_versions")
    .select("id")
    .eq("form_id", formId)
    .eq("status", "published")
    .single();
  const { data: r } = await admin
    .from("responses")
    .insert({
      form_id: formId,
      form_version_id: version!.id,
      status: "in_progress",
    })
    .select("id")
    .single();
  await admin.from("answers").insert([
    { response_id: r!.id, question_id: "q_team", value: team as Json },
    { response_id: r!.id, question_id: "q_nps", value: nps as Json },
  ]);
  await admin
    .from("responses")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      ending_id: "end",
    })
    .eq("id", r!.id);
}

test.describe("phase 4", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-phase4");
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("a running variant test serves the variant and tags the response", async ({
    page,
  }) => {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    await plan(user.userId);
    await adminClient().from("variant_tests").insert({
      form_id: formId,
      variant_id: "v_b",
      name: "Casual vs original",
      split: 99,
    });

    await page.goto(liveLink);
    // 99% of visitors get the variant; retry with fresh visitors for the 1%.
    for (let i = 0; i < 3; i += 1) {
      if (await page.getByText("Who's your crew?").isVisible()) break;
      await page.context().clearCookies();
      await page.goto(liveLink);
    }
    await expect(page.getByText("Who's your crew?")).toBeVisible();
    await page.getByRole("radio", { name: /Beta/ }).click();
    await page.getByRole("radio", { name: "9", exact: true }).click();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("heading", { name: "Thanks!" })).toBeVisible();
    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from("responses")
          .select("variant, status")
          .eq("form_id", formId)
          .eq("status", "completed");
        return data?.map((r) => r.variant);
      })
      .toEqual(["v_b"]);

    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}/settings`);
    await expect(page.getByText("Casual vs original")).toBeVisible();
    await expect(page.getByText(/Too early to tell/)).toBeVisible();
  });

  test("cross-tab of two questions, filtered, and its CSV", async ({ page }) => {
    const { formId } = await createPublishedForm(user, schema);
    await respond(formId, "t_a", 10);
    await respond(formId, "t_a", 3);
    await respond(formId, "t_b", 9);
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}/responses?tab=crosstab&x=q_team&y=q_nps`);
    const table = page.getByRole("region", { name: "Cross-tab" }).getByRole("table");
    await expect(table.getByRole("rowheader", { name: "Alpha" })).toBeVisible();
    await expect(
      page.getByText(/3 completed responses, each counted once/),
    ).toBeVisible();

    const csv = await page.request.get(
      `/api/forms/${formId}/crosstab.csv?x=q_team&y=q_nps`,
    );
    expect(csv.status()).toBe(200);
    const text = (await csv.text()).replace(/^﻿/, "");
    const lines = text.split("\r\n");
    expect(lines[0]).toContain("Which team are you on?");
    expect(lines.at(-1)?.split(",").at(-1)).toBe("3");
  });

  test("a confidential form shows only its report, and won't export", async ({
    page,
  }) => {
    const { formId } = await createPublishedForm(user, schema);
    await adminClient()
      .from("forms")
      .update({ confidential: { threshold: 3, groupQuestionId: "q_team" } as Json })
      .eq("id", formId);
    await respond(formId, "t_a", 10);
    await respond(formId, "t_a", 8);
    await respond(formId, "t_a", 2);
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}/responses`);
    await expect(page.getByText(/Confidential: individual responses/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Average ratings" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /How likely/ })).toBeVisible();
    const exported = await page.request.get(`/api/forms/${formId}/export.csv`);
    expect(exported.status()).toBe(403);
  });
});
