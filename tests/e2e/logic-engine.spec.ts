import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
} from "./helpers";

/**
 * The logic engine as a respondent meets it: personalised by a URL
 * field, a question that appears only when it applies, a cross-field
 * check, and an ending that shows a computed score — then the server's
 * own walk agrees (ending and stored answers).
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Engine journey" },
  theme: {
    primaryColor: "#1f1f1f",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  hiddenFields: [{ name: "name", default: "there" }],
  variables: [{ id: "v_score", name: "score", type: "number" }],
  endings: [
    { id: "end", title: "Done, {{name}}", isDefault: true },
    { id: "end_high", title: "Top score: {{score}}", isDefault: false },
  ],
  questions: [
    {
      id: "q_team",
      type: "single_select",
      order: 0,
      label: "Hi {{name}}, how big is your team?",
      required: true,
      settings: {
        allowOther: false,
        options: [
          {
            id: "solo",
            label: "Just me",
            scores: [{ variableId: "v_score", points: 10 }],
          },
          {
            id: "big",
            label: "50 or more",
            scores: [{ variableId: "v_score", points: 90 }],
          },
        ],
      },
    },
    {
      id: "q_dept",
      type: "short_text",
      order: 1,
      label: "Which department?",
      required: true,
      settings: {},
      visibleIf: {
        type: "compare",
        left: { type: "answer", questionId: "q_team" },
        op: "eq",
        right: { type: "literal", value: "big" },
      },
    },
    {
      id: "q_min",
      type: "number",
      order: 2,
      label: "Smallest budget?",
      required: true,
      settings: {},
    },
    {
      id: "q_max",
      type: "number",
      order: 3,
      label: "Largest budget?",
      required: true,
      settings: {},
      validations: [
        {
          id: "range",
          check: {
            type: "compare",
            left: { type: "answer", questionId: "q_max" },
            op: "gte",
            right: { type: "answer", questionId: "q_min" },
          },
          message: "The largest budget can't be below the smallest.",
        },
      ],
    },
  ],
  logic: [],
  rules: [
    {
      id: "high",
      on: { event: "form_completed" },
      when: {
        type: "compare",
        left: { type: "variable", variableId: "v_score" },
        op: "gte",
        right: { type: "literal", value: 50 },
      },
      then: [{ type: "jump_to_ending", endingId: "end_high" }],
    },
  ],
};

test("a respondent gets the personalised, conditional path and a computed result", async ({
  page,
}) => {
  const user = await createConfirmedUser("e2e-engine");
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    await page.goto(`${liveLink}?name=Grace`);

    await expect(
      page.getByRole("heading", { name: "Hi Grace, how big is your team?" }),
    ).toBeVisible();
    await page.getByRole("radio", { name: /50 or more/ }).click();

    // Shown only for big teams.
    await expect(page.getByRole("heading", { name: /Which department/ })).toBeVisible();
    await page.getByRole("textbox").fill("Research");
    await page.keyboard.press("Enter");

    await page.getByRole("spinbutton").fill("500");
    await page.keyboard.press("Enter");
    await page.getByRole("spinbutton").fill("100");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(
      page.getByText("The largest budget can't be below the smallest."),
    ).toBeVisible();

    await page.getByRole("spinbutton").fill("900");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("heading", { name: "Top score: 90" })).toBeVisible();

    // The server reached the same ending and kept the URL value.
    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from("responses")
          .select("status, ending_id, hidden_fields")
          .eq("form_id", formId)
          .eq("status", "completed")
          .maybeSingle();
        return data;
      })
      .toMatchObject({ ending_id: "end_high", hidden_fields: { name: "Grace" } });
  } finally {
    await deleteUser(user.userId);
  }
});

test("a question that doesn't apply is skipped", async ({ page }) => {
  const user = await createConfirmedUser("e2e-engine-skip");
  try {
    const { liveLink } = await createPublishedForm(user, schema);
    await page.goto(liveLink);
    await expect(
      page.getByRole("heading", { name: "Hi there, how big is your team?" }),
    ).toBeVisible();
    await page.getByRole("radio", { name: /Just me/ }).click();
    await expect(page.getByRole("heading", { name: "Smallest budget?" })).toBeVisible();
    await page.getByRole("spinbutton").fill("1");
    await page.keyboard.press("Enter");
    await page.getByRole("spinbutton").fill("2");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("heading", { name: "Done, there" })).toBeVisible();
  } finally {
    await deleteUser(user.userId);
  }
});
