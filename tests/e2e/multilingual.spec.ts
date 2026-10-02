import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
} from "./helpers";

/** Multilingual forms (P2.21): ?lang= picks a language, FormCraft's own
 * words follow it, the respondent can switch, answers keep their ids and
 * the response records the language. */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Survey" },
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
      label: "What's your name?",
      required: true,
      settings: {},
    },
  ],
  logic: [],
  languages: { default: "en", others: ["es"] },
  translations: {
    es: {
      questions: { q1: { label: "¿Cómo te llamas?" } },
      endings: { end: { title: "¡Gracias!" } },
    },
  },
};

test("a form in Spanish, switchable to English, recording the language", async ({
  page,
}) => {
  const user = await createConfirmedUser("e2e-i18n");
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    await adminClient()
      .from("workspaces")
      .update({ plan_id: "pro" })
      .eq("owner_id", user.userId);

    await page.goto(`${liveLink}?lang=es`);
    await expect(page.getByRole("heading", { name: /¿Cómo te llamas\?/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enviar" })).toBeVisible();

    await page.getByLabel("Idioma").selectOption("en");
    await expect(page.getByRole("heading", { name: /What's your name\?/ })).toBeVisible();
    await page.getByLabel("Language").selectOption("es");

    await page.getByRole("textbox").fill("Ada");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByRole("heading", { name: "¡Gracias!" })).toBeVisible();

    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from("responses")
          .select("language, status, answers(question_id, value)")
          .eq("form_id", formId)
          .eq("status", "completed")
          .maybeSingle();
        return data;
      })
      .toMatchObject({ language: "es", answers: [{ question_id: "q1", value: "Ada" }] });
  } finally {
    await deleteUser(user.userId);
  }
});

test("without the plan, the form shows only its own language", async ({ page }) => {
  const user = await createConfirmedUser("e2e-i18n-free");
  try {
    const { liveLink } = await createPublishedForm(user, schema);
    await page.goto(`${liveLink}?lang=es`);
    await expect(page.getByRole("heading", { name: /What's your name\?/ })).toBeVisible();
    await expect(page.getByLabel("Language")).toHaveCount(0);
  } finally {
    await deleteUser(user.userId);
  }
});
