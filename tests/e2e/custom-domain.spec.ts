import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
} from "./helpers";

/**
 * Custom domains (P2.2) through the real request proxy. Chrome resolves
 * every *.localhost name to this machine, so a verified domain row for
 * "acme-….localhost" behaves like a customer's domain: the bare domain
 * opens the default form, /slug opens the workspace's other forms, and
 * nothing else — not another workspace's form, not the app — is served.
 */
const schema = (title: string): FormSchemaV1 => ({
  schemaVersion: 1,
  meta: { title },
  theme: {
    primaryColor: "#1f1f1f",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: `Thanks from ${title}`, isDefault: true }],
  questions: [
    {
      id: "q1",
      type: "short_text",
      order: 0,
      label: `${title}: your name?`,
      required: true,
      settings: {},
    },
  ],
  logic: [],
});

test("a verified custom domain serves that workspace's forms, and only those", async ({
  page,
}) => {
  const owner = await createConfirmedUser("e2e-domain");
  const stranger = await createConfirmedUser("e2e-domain-other");
  const unique = crypto.randomUUID().slice(0, 8);
  const host = `acme-${unique}.localhost`;
  try {
    const main = await createPublishedForm(owner, schema("Apply"));
    const second = await createPublishedForm(owner, schema("Waitlist"));
    const foreign = await createPublishedForm(stranger, schema("Theirs"));
    const admin = adminClient();
    const { data: form } = await admin
      .from("forms")
      .select("workspace_id")
      .eq("id", main.formId)
      .single();
    await admin.from("custom_domains").insert({
      workspace_id: form!.workspace_id,
      hostname: host,
      status: "verified",
      verification_token: crypto.randomUUID().replace(/-/g, ""),
      default_form_id: main.formId,
    });
    const port =
      new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000").port || "3000";
    const origin = `http://${host}:${port}`;
    const slugOf = (link: string) => link.split("?")[0].split("/").pop()!;

    // The bare domain opens the default form, and it works end to end.
    await page.goto(`${origin}/`);
    await expect(page.getByRole("heading", { name: "Apply: your name?" })).toBeVisible();
    await page.getByRole("textbox").fill("Ada");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("heading", { name: "Thanks from Apply" })).toBeVisible();
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("responses")
          .select("status")
          .eq("form_id", main.formId)
          .eq("status", "completed");
        return data?.length ?? 0;
      })
      .toBe(1);

    // Other forms of the workspace by their link.
    await page.goto(`${origin}/${slugOf(second.liveLink)}`);
    await expect(
      page.getByRole("heading", { name: "Waitlist: your name?" }),
    ).toBeVisible();

    // Not another workspace's form, and not the app.
    expect((await page.goto(`${origin}/${slugOf(foreign.liveLink)}`))?.status()).toBe(
      404,
    );
    expect((await page.goto(`${origin}/dashboard`))?.status()).toBe(404);
    // A domain that isn't connected shows nothing.
    expect((await page.goto(`http://nope-${unique}.localhost:${port}/`))?.status()).toBe(
      404,
    );
  } finally {
    await deleteUser(stranger.userId);
    await deleteUser(owner.userId);
  }
});
