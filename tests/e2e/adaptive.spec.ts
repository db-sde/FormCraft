import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
  waitForSaved,
} from "./helpers";

/**
 * Adaptive assessments (logic spec phase 20) on the live form: the next
 * question follows right and wrong answers, only the questions asked are
 * stored and scored, and a creator can switch a random group to adaptive.
 */
const quiz = (id: string, order: number, label: string) => ({
  id,
  type: "single_select" as const,
  order,
  label,
  required: true,
  settings: {
    allowOther: false,
    options: [
      {
        id: `${id}_right`,
        label: "Right answer",
        correct: true,
        scores: [{ variableId: "v_score", points: 1 }],
      },
      { id: `${id}_wrong`, label: "Wrong answer" },
    ],
  },
});

const schema = {
  schemaVersion: 1,
  meta: { title: "Adaptive quiz" },
  theme: {
    primaryColor: "#1f1f1f",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "All done", isDefault: true }],
  variables: [{ id: "v_score", name: "score", type: "number" }],
  // The hard question comes first in the form on purpose.
  questions: [
    quiz("hard", 0, "Hard question"),
    quiz("easy", 1, "Easy question"),
    quiz("medium", 2, "Medium question"),
  ],
  logic: [],
  pools: [
    {
      id: "bank",
      name: "Question bank",
      questionIds: ["hard", "easy", "medium"],
      pick: 2,
      adaptive: { start: 3, levels: { easy: 1, medium: 3, hard: 5 } },
    },
  ],
} as unknown as FormSchemaV1;

async function take(
  page: import("@playwright/test").Page,
  link: string,
  first: "Right answer" | "Wrong answer",
  expectNext: string,
) {
  await page.context().clearCookies();
  await page.goto(link);
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Medium question" })).toBeVisible();
  await page.getByRole("radio", { name: first }).click();
  await expect(page.getByRole("heading", { name: expectNext })).toBeVisible();
  await page.getByRole("radio", { name: "Right answer" }).click();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByRole("heading", { name: "All done" })).toBeVisible();
}

test("the next question follows right and wrong answers; only asked ones are stored", async ({
  page,
}) => {
  const user = await createConfirmedUser("e2e-adaptive");
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    await take(page, liveLink, "Right answer", "Hard question");
    await take(page, liveLink, "Wrong answer", "Easy question");

    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from("responses")
          .select("status, answers(question_id)")
          .eq("form_id", formId)
          .eq("status", "completed")
          .order("completed_at");
        return (data ?? []).map((r) => r.answers.map((a) => a.question_id).sort());
      })
      .toEqual([
        ["hard", "medium"],
        ["easy", "medium"],
      ]);

    // The creator sees the group as adaptive and can switch it back.
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}`);
    await page.getByRole("button", { name: /^Logic/ }).click();
    await page.getByRole("tab", { name: /Random/ }).click();
    const toggle = page.getByRole("switch", { name: "Make Question bank adaptive" });
    await expect(toggle).toBeChecked();
    await expect(page.getByLabel("Difficulty of question 1")).toHaveValue("5");
    await page.getByLabel("Difficulty of question 1").selectOption("4");
    await waitForSaved(page);
    const { data: draft } = await adminClient()
      .from("form_versions")
      .select("schema")
      .eq("form_id", formId)
      .eq("status", "draft")
      .single();
    expect(
      (draft!.schema as unknown as FormSchemaV1).pools![0].adaptive!.levels.hard,
    ).toBe(4);
  } finally {
    await deleteUser(user.userId);
  }
});
