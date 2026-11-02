import { createServer, type Server } from "node:http";
import { test, expect, type Page } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { saveConnection } from "@/domains/connectors/framework";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
  loginViaUI,
} from "./helpers";

/**
 * Master spec Phase 6 through the running app, against a fake Airtable:
 * a creator links a connected app to a form, maps a field, and a
 * respondent's submission arrives as one record keyed by the response
 * ID; disconnecting offers to connect again through OAuth.
 */
// playwright.config.ts points the app at this port (FAKE_AIRTABLE_PORT).
const PORT = 4602;
const records = new Map<string, Record<string, unknown>>();
let server: Server;

const TABLE = {
  id: "tblLeads",
  name: "Leads",
  fields: [
    { id: "fldResp", name: "Response", type: "singleLineText" },
    { id: "fldName", name: "Name", type: "singleLineText" },
    { id: "fldTotal", name: "Total", type: "formula" },
  ],
};

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      res.setHeader("content-type", "application/json");
      if (req.method === "GET" && path === "/v0/meta/bases") {
        return res.end(JSON.stringify({ bases: [{ id: "appE2E", name: "CRM base" }] }));
      }
      if (req.method === "GET" && path === "/v0/meta/bases/appE2E/tables") {
        return res.end(JSON.stringify({ tables: [TABLE] }));
      }
      if (req.method === "PATCH" && path === "/v0/appE2E/tblLeads") {
        const body = JSON.parse(raw) as {
          performUpsert: { fieldsToMergeOn: string[] };
          records: { fields: Record<string, unknown> }[];
        };
        const fields = body.records[0].fields;
        const key = String(fields[body.performUpsert.fieldsToMergeOn[0]]);
        const created = !records.has(key);
        records.set(key, { ...(records.get(key) ?? {}), ...fields });
        return res.end(
          JSON.stringify({
            records: [{ id: `rec${key.slice(0, 6)}` }],
            createdRecords: created ? [`rec${key.slice(0, 6)}`] : [],
          }),
        );
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: "not found" } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Get in touch" },
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
      id: "q_name",
      type: "short_text",
      order: 0,
      label: "Your name",
      required: true,
      settings: {},
    },
  ],
};

async function pick(page: Page, combobox: string, option: string) {
  await page.getByRole("combobox", { name: combobox, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test.describe("phase 6", () => {
  let user: Awaited<ReturnType<typeof createConfirmedUser>>;
  test.beforeEach(async () => {
    user = await createConfirmedUser("e2e-phase6");
  });
  test.afterEach(async () => {
    await deleteUser(user.userId);
  });

  test("link Airtable to a form; a submission arrives as one record; disconnect", async ({
    page,
  }) => {
    const { formId, liveLink } = await createPublishedForm(user, schema);
    const admin = adminClient();
    const { data: form } = await admin
      .from("forms")
      .select("workspace_id")
      .eq("id", formId)
      .single();
    await saveConnection(admin, {
      workspaceId: form!.workspace_id,
      userId: null,
      provider: "airtable",
      tokens: { accessToken: "e2e-token" },
      label: "ops@example.com",
      createdBy: user.userId,
    });

    await loginViaUI(page, user.email, user.password);
    await page.goto(`/forms/${formId}/integrations`);
    await expect(page.getByRole("heading", { name: "Apps" })).toBeVisible();
    const card = page.getByRole("group", { name: "Airtable" });
    await expect(card.getByText("Connected as ops@example.com")).toBeVisible();
    await card.getByRole("button", { name: "Send this form's responses" }).click();
    await pick(page, "Base", "CRM base");
    await pick(page, "Table", "Leads");
    await pick(page, "Response ID field", "Response");
    // Fields the app can't take are named, not offered.
    await expect(
      card.getByText(/Can't be filled from a form: Total \(formula\)/),
    ).toBeVisible();
    await card.getByRole("button", { name: "Add a field" }).click();
    await pick(page, "Field 1", "Name");
    await pick(page, "Value for field 1", "1 · Your name");
    await card.getByRole("button", { name: "Save", exact: true }).click();
    await expect(card.getByText(/On · 1 field mapped/)).toBeVisible();

    // A respondent submits; the record arrives keyed by the response ID.
    const visitor = await page.context().browser()!.newContext();
    const p2 = await visitor.newPage();
    await p2.goto(liveLink);
    await p2.getByRole("textbox").fill("Grace Hopper");
    await p2.getByRole("button", { name: "Submit" }).click();
    await expect(p2.getByRole("heading", { name: "Thanks!" })).toBeVisible();
    await visitor.close();
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("connector_jobs")
          .select("status, response_id")
          .eq("workspace_id", form!.workspace_id)
          .eq("provider", "airtable");
        return data;
      })
      .toEqual([{ status: "succeeded", response_id: expect.any(String) }]);
    const { data: job } = await admin
      .from("connector_jobs")
      .select("response_id")
      .eq("workspace_id", form!.workspace_id)
      .single();
    expect(records.get(job!.response_id!)).toEqual({
      fldResp: job!.response_id,
      fldName: "Grace Hopper",
    });

    // Disconnecting stops it for every form and offers to connect again.
    await page.reload();
    await card.getByRole("button", { name: "Disconnect" }).click();
    await card.getByRole("button", { name: "Disconnect for every form" }).click();
    const connect = card.getByRole("link", { name: "Connect Airtable" });
    await expect(connect).toBeVisible();
    const href = await connect.getAttribute("href");
    expect(href).toContain("/api/connectors/airtable/authorize");
    const res = await page.request.get(href!, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const to = new URL(res.headers().location);
    expect(to.origin + to.pathname).toBe("https://airtable.com/oauth2/v1/authorize");
    expect(to.searchParams.get("code_challenge_method")).toBe("S256");
    expect(to.searchParams.get("redirect_uri")).toMatch(
      /\/api\/connectors\/oauth\/callback$/,
    );
  });
});
