import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { setFormPassword } from "@/domains/forms/access";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/**
 * Phase 0 guardrails through the running app (master spec F-26, F-46,
 * F-47, F-48): what respondents see, and that the routes refuse what the
 * screens hide.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Members' survey" },
  theme: {
    primaryColor: "#0f172a",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks!", isDefault: true }],
  questions: [
    {
      id: "q_secret",
      type: "short_text",
      order: 0,
      label: "What is the club's motto?",
      required: true,
      settings: {},
    },
  ],
  logic: [],
};

const complete = (responseId: string, extra: Record<string, unknown> = {}) => ({
  clientRevision: 1,
  lastQuestionId: "q_secret",
  answers: { q_secret: "Onwards" },
  idempotencyKey: crypto.randomUUID(),
  ...extra,
});

test.describe("who can respond", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;

  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-access");
  });

  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("a password-protected form shows nothing until the right password, then works", async ({
    page,
  }) => {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    await setFormPassword(adminClient(), formId, "club-2026");

    const response = await page.goto(liveLink);
    await expect(page.getByTestId("password-gate")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Members' survey" })).toBeVisible();
    // The question isn't anywhere in what the server sent.
    expect(await response!.text()).not.toContain("club's motto");

    // The API refuses too, not just the screen.
    const locked = await page.request.post("/api/responses/start", { data: { formId } });
    expect(locked.status()).toBe(403);
    expect((await locked.json()).error.code).toBe("locked");

    await page.getByLabel("Password").fill("wrong-one");
    await page.getByRole("button", { name: "Open form" }).click();
    await expect(page.getByText("That password isn't right.")).toBeVisible();

    await page.getByLabel("Password").fill("club-2026");
    await page.getByRole("button", { name: "Open form" }).click();
    await expect(page.getByText("What is the club's motto?")).toBeVisible();

    // The unlock cookie now lets this browser start and submit.
    const start = await page.request.post("/api/responses/start", { data: { formId } });
    expect(start.ok()).toBeTruthy();
    const { responseId } = await start.json();

    // A new password locks out everyone who used the old one.
    await setFormPassword(adminClient(), formId, "new-pass-2027");
    const afterChange = await page.request.post(`/api/responses/${responseId}/complete`, {
      data: complete(responseId),
    });
    expect(afterChange.status()).toBe(403);
    await page.reload();
    await expect(page.getByTestId("password-gate")).toBeVisible();
  });

  test("a form past its close date shows the creator's message and refuses submits", async ({
    page,
  }) => {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    // Started while open…
    const start = await page.request.post("/api/responses/start", { data: { formId } });
    const { responseId } = await start.json();
    // …then the deadline passes.
    await adminClient()
      .from("forms")
      .update({
        closes_at: new Date(Date.now() - 1000).toISOString(),
        closed_message: "Entries closed at noon.",
      })
      .eq("id", formId);

    await page.goto(liveLink);
    await expect(page.getByTestId("form-closed")).toBeVisible();
    await expect(page.getByText("Entries closed at noon.")).toBeVisible();
    // Embeds show the same screen.
    await page.goto(`${liveLink}?embed=1`);
    await expect(page.getByText("Entries closed at noon.")).toBeVisible();

    const late = await page.request.post(`/api/responses/${responseId}/complete`, {
      data: complete(responseId),
    });
    expect(late.status()).toBe(410);
    expect((await late.json()).error).toMatchObject({
      code: "form_closed",
      reason: "closed",
      message: "Entries closed at noon.",
    });
    const fresh = await page.request.post("/api/responses/start", { data: { formId } });
    expect(fresh.status()).toBe(410);
  });

  test("a full form closes itself once the cap is reached", async ({ page }) => {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    await adminClient()
      .from("forms")
      .update({ response_cap: 1, full_message: "All 1 places are taken." })
      .eq("id", formId);

    const a = await (
      await page.request.post("/api/responses/start", { data: { formId } })
    ).json();
    const b = await (
      await page.request.post("/api/responses/start", { data: { formId } })
    ).json();
    const first = await page.request.post(`/api/responses/${a.responseId}/complete`, {
      data: complete(a.responseId),
    });
    expect(first.ok()).toBeTruthy();
    const second = await page.request.post(`/api/responses/${b.responseId}/complete`, {
      data: complete(b.responseId),
    });
    expect(second.status()).toBe(410);
    expect((await second.json()).error.reason).toBe("full");

    await page.goto(liveLink);
    await expect(page.getByText("All 1 places are taken.")).toBeVisible();
  });

  test("a form that requires a CAPTCHA never accepts an unverified submit", async ({
    page,
  }) => {
    const { formId } = await createPublishedForm(user, schema);
    await adminClient().from("forms").update({ captcha_required: true }).eq("id", formId);

    const { responseId } = await (
      await page.request.post("/api/responses/start", { data: { formId } })
    ).json();
    // No token. Whether or not this server has Turnstile keys, the
    // submit is refused (fail closed) and the response stays open.
    const res = await page.request.post(`/api/responses/${responseId}/complete`, {
      data: complete(responseId),
    });
    expect([400, 503]).toContain(res.status());
    expect(["captcha_failed", "captcha_unavailable"]).toContain(
      (await res.json()).error.code,
    );
    const { data } = await adminClient()
      .from("responses")
      .select("status")
      .eq("id", responseId)
      .single();
    expect(data?.status).not.toBe("completed");
  });

  test("the creator sets a limit, a close date and a password in Settings", async ({
    page,
  }) => {
    const { formId } = await createPublishedForm(user, schema);
    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}/settings`);
    const panel = page.getByTestId("form-access-panel");

    await panel.getByRole("switch", { name: "Limit the number of responses" }).click();
    await panel.getByLabel("Maximum responses").fill("50");
    await panel.getByRole("switch", { name: "Close on a date" }).click();
    await panel.getByLabel("Closes at").fill("2030-01-15T17:30");
    await panel.getByRole("button", { name: "Save closing settings" }).click();
    await expect(page.getByText("Saved.").first()).toBeVisible();

    await panel.getByLabel("Password", { exact: true }).fill("letmein");
    await panel.getByRole("button", { name: "Set password" }).click();
    await expect(panel.getByTestId("password-status")).toHaveText(
      "On: the form asks for a password.",
    );

    const { data: form } = await adminClient()
      .from("forms")
      .select("response_cap, closes_at")
      .eq("id", formId)
      .single();
    expect(form?.response_cap).toBe(50);
    expect(form?.closes_at).not.toBeNull();
    const { data: secret } = await adminClient()
      .from("form_access_secrets")
      .select("password_hash")
      .eq("form_id", formId)
      .single();
    expect(secret?.password_hash).toMatch(/^scrypt\$/);

    // Each change is in the audit log.
    const { data: log } = await adminClient()
      .from("audit_logs")
      .select("action")
      .eq("target_id", formId);
    expect((log ?? []).map((l) => l.action)).toEqual(
      expect.arrayContaining(["form.availability_changed", "form.password_set"]),
    );
  });
});
