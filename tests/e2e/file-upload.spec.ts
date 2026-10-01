import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
} from "./helpers";

/**
 * File uploads from the respondent's side, end to end: the file really
 * is stored and tied to the response, survives a refresh (the browser
 * forgets the file — the server must not), the submitted answer points
 * at the stored upload, and a file that isn't what it claims to be is
 * refused.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Upload form" },
  theme: {
    primaryColor: "#4f46e5",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks!", isDefault: true }],
  questions: [
    {
      id: "q_file",
      type: "file_upload",
      order: 0,
      label: "Attach your logo",
      required: true,
      settings: { acceptedMimeTypes: ["image/png"], maxSizeMb: 1 },
    },
    {
      id: "q_note",
      type: "short_text",
      order: 1,
      label: "Anything to add?",
      required: false,
      settings: {},
    },
  ],
  logic: [],
};

// A real 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("an uploaded file survives a refresh and ends up attached to the submission", async ({
  page,
}) => {
  const user = await createConfirmedUser("e2e-upload");
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    await page.goto(liveLink);

    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByText("logo.png")).toBeVisible();
    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from("uploads")
          .select("status, responses!inner(form_id)")
          .eq("responses.form_id", formId);
        return data?.map((u) => u.status);
      })
      .toEqual(["clean"]);

    // Let the autosave record the answer, then reload mid-form.
    await page.waitForTimeout(1500);
    await page.reload();
    await expect(
      page.getByText("File uploaded — choose another to replace it"),
    ).toBeVisible();

    // The required question counts as answered without picking the file again.
    await page.getByRole("button", { name: "OK" }).click();
    await expect(page.getByText("Anything to add?")).toBeVisible();
    await page.getByRole("textbox").fill("thanks");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Thanks!")).toBeVisible();

    const admin = adminClient();
    const { data: uploads } = await admin
      .from("uploads")
      .select("id, question_id, storage_path, responses!inner(form_id, status)")
      .eq("responses.form_id", formId);
    expect(uploads).toHaveLength(1);
    expect(uploads![0].responses?.status).toBe("completed");

    const { data: answer } = await admin
      .from("answers")
      .select("value, responses!inner(form_id)")
      .eq("responses.form_id", formId)
      .eq("question_id", "q_file")
      .single();
    // The answer is the upload's id — never a URL or the file itself.
    expect(answer?.value).toBe(uploads![0].id);

    const { data: stored, error } = await admin.storage
      .from("response-uploads")
      .download(uploads![0].storage_path);
    expect(error).toBeNull();
    expect(Buffer.from(await stored!.arrayBuffer()).equals(PNG)).toBe(true);
  } finally {
    await deleteUser(user.userId);
  }
});

test("a file that isn't really a PNG is refused and can't satisfy the question", async ({
  page,
}) => {
  const user = await createConfirmedUser("e2e-upload-bad");
  try {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    await page.goto(liveLink);

    // Named and labelled as a PNG, but the bytes are a script.
    await page.locator('input[type="file"]').setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: Buffer.from("#!/bin/sh\necho not an image\n"),
    });
    await expect(
      page.getByText("Upload failed — please try a different file."),
    ).toBeVisible();

    await page.getByRole("button", { name: "OK" }).click();
    // Still on the same question: nothing valid was attached.
    await expect(page.getByText("Attach your logo")).toBeVisible();

    const { data } = await adminClient()
      .from("uploads")
      .select("id, responses!inner(form_id)")
      .eq("responses.form_id", formId);
    expect(data).toEqual([]);
  } finally {
    await deleteUser(user.userId);
  }
});
