import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
  skipWelcomeDialog,
} from "./helpers";

/**
 * Wave C in the browser and over HTTP: the SCIM endpoints an identity
 * provider calls (P3.18), "Log in with SSO" and a workspace that
 * requires it (P3.12), and privacy requests in Settings → Security
 * (P3.17). No real identity provider: SAML itself is Supabase Auth's.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Newsletter" },
  theme: {
    primaryColor: "#1f1f1f",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks!", isDefault: true }],
  questions: [
    { id: "mail", type: "email", order: 0, label: "Email", required: true, settings: {} },
  ],
  logic: [],
};

async function enterpriseWorkspace(prefix: string) {
  const owner = await createConfirmedUser(prefix);
  const { formId } = await createPublishedForm(owner, schema);
  const admin = adminClient();
  const { data: form } = await admin
    .from("forms")
    .select("workspace_id")
    .eq("id", formId)
    .single();
  const workspaceId = form!.workspace_id;
  await admin.from("workspaces").update({ plan_id: "enterprise" }).eq("id", workspaceId);
  await admin.from("workspace_sso").insert({
    workspace_id: workspaceId,
    domain: `${prefix}-${crypto.randomUUID().slice(0, 8)}.example`,
    provider_id: crypto.randomUUID(),
  });
  return { owner, formId, workspaceId };
}

test("SCIM: an identity provider lists, adds, deactivates and removes people", async ({
  page,
  request,
}) => {
  const { owner } = await enterpriseWorkspace("e2e-scim");
  try {
    // An admin makes the token in Settings → Security; it's shown once.
    await loginViaUI(page, owner.email, owner.password);
    await page.goto("/settings?tab=security");
    await page.getByRole("button", { name: "Create token" }).click();
    const token = (await page
      .locator("span.font-mono", { hasText: "scim_" })
      .textContent())!;
    expect(token).toMatch(/^scim_[A-Za-z0-9_-]{40,}$/);
    const auth = { Authorization: `Bearer ${token}` };

    expect((await request.get("/api/scim/v2/Users")).status()).toBe(401);
    const config = await request.get("/api/scim/v2/ServiceProviderConfig", {
      headers: auth,
    });
    expect(config.headers()["content-type"]).toContain("application/scim+json");
    expect((await config.json()).patch.supported).toBe(true);
    expect(
      (await (await request.get("/api/scim/v2/ResourceTypes", { headers: auth })).json())
        .Resources[0].id,
    ).toBe("User");
    expect(
      (await (await request.get("/api/scim/v2/Schemas", { headers: auth })).json())
        .totalResults,
    ).toBe(1);

    const created = await request.post("/api/scim/v2/Users", {
      headers: auth,
      data: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: "Ada@Corp.example",
        name: { givenName: "Ada", familyName: "Lovelace" },
        active: true,
      },
    });
    expect(created.status()).toBe(201);
    const user = await created.json();
    expect(user).toMatchObject({
      userName: "ada@corp.example",
      displayName: "Ada Lovelace",
      active: true,
    });
    const again = await request.post("/api/scim/v2/Users", {
      headers: auth,
      data: { userName: "ada@corp.example" },
    });
    expect(again.status()).toBe(409);
    expect((await again.json()).scimType).toBe("uniqueness");

    const lookup = await (
      await request.get(
        `/api/scim/v2/Users?filter=${encodeURIComponent('userName eq "ada@corp.example"')}`,
        { headers: auth },
      )
    ).json();
    expect(lookup).toMatchObject({ totalResults: 1, startIndex: 1, itemsPerPage: 1 });
    expect(lookup.Resources[0].id).toBe(user.id);
    expect(
      (
        await request.get(
          `/api/scim/v2/Users?filter=${encodeURIComponent('title co "x"')}`,
          {
            headers: auth,
          },
        )
      ).status(),
    ).toBe(400);

    const patched = await request.patch(`/api/scim/v2/Users/${user.id}`, {
      headers: auth,
      data: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "replace", value: { active: false } }],
      },
    });
    expect((await patched.json()).active).toBe(false);
    const replaced = await request.put(`/api/scim/v2/Users/${user.id}`, {
      headers: auth,
      data: { userName: "ada@corp.example", displayName: "Ada L", active: true },
    });
    expect(await replaced.json()).toMatchObject({ displayName: "Ada L", active: true });

    expect(
      (await request.delete(`/api/scim/v2/Users/${user.id}`, { headers: auth })).status(),
    ).toBe(204);
    const gone = await request.get(`/api/scim/v2/Users/${user.id}`, { headers: auth });
    expect(gone.status()).toBe(404);
    expect((await gone.json()).schemas).toEqual([
      "urn:ietf:params:scim:api:messages:2.0:Error",
    ]);
  } finally {
    await deleteUser(owner.userId);
  }
});

test("SSO: the login page, and a workspace that requires it", async ({ page }) => {
  const { owner, workspaceId } = await enterpriseWorkspace("e2e-sso");
  const member = await createConfirmedUser("e2e-sso-member");
  try {
    const admin = adminClient();
    await admin
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: member.userId, role: "editor" });

    // The owner requires SSO in Settings → Security.
    await loginViaUI(page, owner.email, owner.password);
    await page.goto("/settings?tab=security");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("switch", { name: /Require single sign-on/ }).click();
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("workspace_sso")
          .select("enforced")
          .eq("workspace_id", workspaceId)
          .single();
        return data?.enforced;
      })
      .toBe(true);
    // The owner is exempt and still gets in.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);

    // A member with only a password is sent to sign in with SSO.
    await page.context().clearCookies();
    await skipWelcomeDialog(page);
    await page.goto("/login");
    await page.getByLabel("Email").fill(member.email);
    await page.getByLabel("Password").fill(member.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/login/sso?notice=required");
    await expect(page.getByText("Your workspace requires single sign-on.")).toBeVisible();

    // A domain with no identity provider says so.
    await page.getByLabel("Work email").fill("someone@no-sso.example");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByText("Single sign-on isn't set up for no-sso.example."),
    ).toBeVisible();
  } finally {
    await deleteUser(member.userId);
    await deleteUser(owner.userId);
  }
});

test("privacy request: find a person's responses, export them, erase them", async ({
  page,
  request,
}) => {
  const { owner, formId } = await enterpriseWorkspace("e2e-privacy");
  try {
    const email = `ada-${crypto.randomUUID().slice(0, 8)}@example.com`;
    for (const value of [email, "someone-else@example.com"]) {
      const { responseId } = await (
        await request.post("/api/responses/start", { data: { formId } })
      ).json();
      await request.post(`/api/responses/${responseId}/complete`, {
        data: {
          clientRevision: 1,
          lastQuestionId: "mail",
          answers: { mail: value },
          idempotencyKey: crypto.randomUUID(),
        },
      });
    }

    await loginViaUI(page, owner.email, owner.password);
    await page.goto("/settings?tab=security");
    await page.getByLabel("Their email address").fill(email);
    await page.getByRole("button", { name: "Find their data" }).click();
    await expect(page.getByText("1 response", { exact: true })).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export as JSON" }).click();
    expect((await download).suggestedFilename()).toBe("formcraft-personal-data.json");

    const erase = page.getByRole("button", { name: "Delete their data" });
    await expect(erase).toBeDisabled();
    await page.getByLabel(/type the address again/).fill(email);
    await erase.click();
    await expect(page.getByText(/No responses in this workspace have/)).toBeVisible();

    const admin = adminClient();
    const { data: left } = await admin
      .from("responses")
      .select("answers(value)")
      .eq("form_id", formId);
    expect(left?.map((r) => r.answers[0].value)).toEqual(["someone-else@example.com"]);
    const { data: log } = await admin
      .from("audit_logs")
      .select("action, metadata")
      .like("action", "privacy.%")
      .order("id");
    const mine = (log ?? []).filter((l) => !JSON.stringify(l.metadata).includes(email));
    expect(mine.map((l) => l.action)).toEqual(
      expect.arrayContaining(["privacy.data_exported", "privacy.data_deleted"]),
    );
    // The address itself never goes into the log.
    expect(JSON.stringify(log)).not.toContain(email);
  } finally {
    await deleteUser(owner.userId);
  }
});
