import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { completeResponse, startResponse } from "@/domains/responses";
import "@/domains/connectors/registry";
import { saveConnection } from "@/domains/connectors/framework";
import { enqueueConnectorSyncs } from "@/domains/connectors/links";

/**
 * Integration audit (roadmap v3.1 §J, docs/integration-audit.md): Notion
 * (F-36) and Zoho CRM (F-40) against the real database, each app faked at
 * the fetch level, as connectors.test.ts does for the others. A submitted
 * response becomes one page / one record; a retry finds what the first
 * try made; a date-and-time answer reaches a date-time field as ISO 8601
 * (it used to go as display text, which both apps refuse); Zoho calls go
 * to the account's own data centre.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin: SupabaseClient<Database> = createClient<Database>(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().slice(0, 8);

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Demo request" },
  theme: {
    primaryColor: "#0f172a",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  logic: [],
  questions: [
    {
      id: "q_name",
      type: "short_text",
      order: 0,
      label: "Name",
      required: true,
      settings: {},
    },
    {
      id: "q_email",
      type: "email",
      order: 1,
      label: "Email",
      required: true,
      settings: {},
    },
    {
      id: "q_when",
      type: "datetime",
      order: 2,
      label: "When should we call?",
      required: true,
      settings: {},
    },
  ],
} as FormSchemaV1;

let ownerId: string;
let workspaceId: string;
let formId: string;

beforeAll(async () => {
  const { data: user, error } = await admin.auth.admin.createUser({
    email: `nz-${runId}@example.com`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (error) throw error;
  ownerId = user.user.id;
  const { data: ws } = await admin
    .from("workspaces")
    .insert({
      name: "Apps 2",
      slug: `nz-${runId}`,
      owner_id: ownerId,
      plan_id: "business",
    })
    .select("id")
    .single();
  workspaceId = ws!.id;
  await admin.from("workspace_members").insert({
    workspace_id: workspaceId,
    user_id: ownerId,
    role: "owner",
    permissions: {},
  });
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Demo request",
      slug: `nz-${runId}`,
      created_by: ownerId,
    })
    .select("id")
    .single();
  formId = form!.id;
  const s = schema as unknown as Json;
  await admin
    .from("form_versions")
    .insert({ form_id: formId, status: "draft", version_number: 1, schema: s });
  const { error: pub } = await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: s,
  });
  if (pub) throw pub;
}, 60_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", workspaceId);
  await admin.auth.admin.deleteUser(ownerId);
});

async function submitted(): Promise<string> {
  const { responseId } = await startResponse(admin, formId);
  const done = await completeResponse(
    admin,
    responseId,
    1,
    "q_when",
    {
      q_name: "Asha Rao",
      q_email: "Asha@Example.com",
      q_when: "2026-11-24T15:30+05:30",
    } as never,
    crypto.randomUUID(),
  );
  expect(done.ok).toBe(true);
  return responseId;
}

async function link(
  provider: string,
  settings: Record<string, unknown>,
  mapping: unknown[],
) {
  await admin.from("connector_links").delete().eq("form_id", formId);
  const { error } = await admin.from("connector_links").insert({
    form_id: formId,
    provider,
    settings: settings as Json,
    mapping: mapping as Json,
  });
  if (error) throw error;
}

async function jobsFor(responseId: string) {
  const { data } = await admin
    .from("connector_jobs")
    .select("status, last_error, result")
    .eq("response_id", responseId);
  return data ?? [];
}

type Call = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
};
const parse = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return body; // a form-encoded token request
  }
};
function recorder(handle: (call: Call) => [number, unknown]) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? parse(init.body) : null,
    };
    calls.push(call);
    const [status, data] = handle(call);
    return new Response(JSON.stringify(data), { status });
  }) as typeof fetch;
  return { fetcher, calls };
}

describe("Notion (F-36)", () => {
  it("makes one page per response, with the date-time as ISO; a retry updates it", async () => {
    await saveConnection(admin, {
      workspaceId,
      userId: null,
      provider: "notion",
      tokens: { accessToken: "secret_notion", extra: { workspace_name: "Acme" } },
      label: "Acme",
      createdBy: ownerId,
    });
    await link("notion", { databaseId: "db1", idProperty: "pRid" }, [
      { field: "title", source: "answer:q_name" },
      { field: "pMail", source: "answer:q_email" },
      { field: "pWhen", source: "answer:q_when" },
    ]);
    const pages: { id: string; properties: Record<string, unknown> }[] = [];
    const app = recorder((c) => {
      if (c.method === "GET" && c.url.endsWith("/databases/db1"))
        return [
          200,
          {
            id: "db1",
            properties: {
              Name: { id: "title", name: "Name", type: "title" },
              Email: { id: "pMail", name: "Email", type: "email" },
              When: { id: "pWhen", name: "Call at", type: "date" },
              Response: { id: "pRid", name: "Response", type: "rich_text" },
            },
          },
        ];
      if (c.method === "POST" && c.url.endsWith("/databases/db1/query"))
        return [200, { results: pages.slice(0, 1).map((p) => ({ id: p.id })) }];
      if (c.method === "POST" && c.url.endsWith("/v1/pages")) {
        const props = (c.body as { properties: Record<string, unknown> }).properties;
        pages.push({ id: `page${pages.length + 1}`, properties: props });
        return [200, { id: `page${pages.length}` }];
      }
      if (c.method === "PATCH" && c.url.endsWith("/v1/pages/page1"))
        return [200, { id: "page1" }];
      return [404, { message: "no route" }];
    });

    const id = await submitted();
    await enqueueConnectorSyncs(admin, id, { fetch: app.fetcher });
    expect(await jobsFor(id)).toMatchObject([
      {
        status: "succeeded",
        last_error: null,
        result: { pageId: "page1", created: true },
      },
    ]);
    const create = app.calls.find(
      (c) => c.method === "POST" && c.url.endsWith("/pages"),
    )!;
    expect(create.headers["notion-version"]).toBe("2022-06-28");
    expect(create.headers.authorization).toBe("Bearer secret_notion");
    expect(create.body).toMatchObject({
      parent: { database_id: "db1" },
      properties: {
        title: { title: [{ text: { content: "Asha Rao" } }] },
        pMail: { email: "Asha@Example.com" },
        pWhen: { date: { start: "2026-11-24T10:00:00.000Z" } },
        pRid: { rich_text: [{ text: { content: id } }] },
      },
    });
    const query = app.calls.find((c) => c.url.endsWith("/query"))!;
    expect(query.body).toEqual({
      filter: { property: "pRid", rich_text: { equals: id } },
      page_size: 1,
    });

    // Sent again (a replay): found by the response ID, updated, not doubled.
    await admin.from("connector_jobs").delete().eq("response_id", id);
    await enqueueConnectorSyncs(admin, id, { fetch: app.fetcher });
    expect(await jobsFor(id)).toMatchObject([
      { status: "succeeded", result: { pageId: "page1", created: false } },
    ]);
    expect(pages).toHaveLength(1);
  });

  it("explains a database that's no longer shared instead of retrying", async () => {
    const app = recorder(() => [404, { message: "Could not find database" }]);
    const id = await submitted();
    await enqueueConnectorSyncs(admin, id, { fetch: app.fetcher });
    expect(await jobsFor(id)).toMatchObject([
      {
        status: "exhausted",
        last_error: "The database was deleted or is no longer shared with FormCraft",
      },
    ]);
  });
});

describe("Zoho CRM (F-40)", () => {
  it("upserts a lead on Email in the account's own data centre, with an ISO date-time", async () => {
    await saveConnection(admin, {
      workspaceId,
      userId: null,
      provider: "zoho_crm",
      tokens: {
        accessToken: "zoho-at",
        refreshToken: "zoho-rt",
        expiresAt: Date.now() + 3_600_000,
        extra: {
          api_domain: "https://www.zohoapis.in",
          accounts_server: "https://accounts.zoho.in",
        },
      },
      label: "www.zohoapis.in",
      createdBy: ownerId,
    });
    await link("zoho_crm", { module: "Leads" }, [
      { field: "Last_Name", source: "answer:q_name" },
      { field: "Email", source: "answer:q_email" },
      { field: "Call_At", source: "answer:q_when" },
    ]);
    const app = recorder((c) => {
      if (c.url.includes("/settings/fields?module=Leads"))
        return [
          200,
          {
            fields: [
              {
                api_name: "Last_Name",
                field_label: "Last Name",
                data_type: "text",
                system_mandatory: true,
              },
              { api_name: "Email", field_label: "Email", data_type: "email" },
              { api_name: "Call_At", field_label: "Call at", data_type: "datetime" },
              {
                api_name: "Created_Time",
                field_label: "Created",
                data_type: "datetime",
                read_only: true,
              },
            ],
          },
        ];
      if (c.method === "POST" && c.url.endsWith("/Leads/upsert"))
        return [
          200,
          { data: [{ status: "success", action: "insert", details: { id: "zl1" } }] },
        ];
      return [404, { message: "no route" }];
    });

    const id = await submitted();
    await enqueueConnectorSyncs(admin, id, { fetch: app.fetcher });
    expect(await jobsFor(id)).toMatchObject([
      { status: "succeeded", last_error: null, result: { id: "zl1", created: true } },
    ]);
    expect(
      app.calls.every((c) => c.url.startsWith("https://www.zohoapis.in/crm/v6/")),
    ).toBe(true);
    const upsert = app.calls.find((c) => c.url.endsWith("/upsert"))!;
    expect(upsert.headers.authorization).toBe("Zoho-oauthtoken zoho-at");
    expect(upsert.body).toEqual({
      data: [
        {
          Last_Name: "Asha Rao",
          Email: "Asha@Example.com",
          Call_At: "2026-11-24T10:00:00+00:00",
        },
      ],
      duplicate_check_fields: ["Email"],
    });
  });

  it("refreshes an expired token at the account's own accounts server", async () => {
    process.env.ZOHO_CLIENT_ID = "zid";
    process.env.ZOHO_CLIENT_SECRET = "zsecret";
    await saveConnection(admin, {
      workspaceId,
      userId: null,
      provider: "zoho_crm",
      tokens: {
        accessToken: "stale",
        refreshToken: "zoho-rt",
        expiresAt: Date.now() - 1000,
        extra: {
          api_domain: "https://www.zohoapis.in",
          accounts_server: "https://accounts.zoho.in",
        },
      },
      label: null,
      createdBy: ownerId,
    });
    const app = recorder((c) => {
      if (c.url.includes("/oauth/v2/token"))
        return [200, { access_token: "fresh", expires_in: 3600 }];
      if (c.url.includes("/settings/fields"))
        return [
          200,
          {
            fields: [
              {
                api_name: "Last_Name",
                field_label: "Last Name",
                data_type: "text",
                system_mandatory: true,
              },
              { api_name: "Email", field_label: "Email", data_type: "email" },
              { api_name: "Call_At", field_label: "Call at", data_type: "datetime" },
            ],
          },
        ];
      return [
        200,
        { data: [{ status: "success", action: "update", details: { id: "zl1" } }] },
      ];
    });
    const id = await submitted();
    await enqueueConnectorSyncs(admin, id, { fetch: app.fetcher });
    expect(await jobsFor(id)).toMatchObject([
      { status: "succeeded", result: { id: "zl1", created: false } },
    ]);
    expect(app.calls[0].url).toBe("https://accounts.zoho.in/oauth/v2/token");
    expect(app.calls.find((c) => c.url.endsWith("/upsert"))!.headers.authorization).toBe(
      "Zoho-oauthtoken fresh",
    );
  });

  it("reports Zoho's own refusal with the field it names", async () => {
    const app = recorder((c) => {
      if (c.url.includes("/oauth/v2/token"))
        return [200, { access_token: "fresh2", expires_in: 3600 }];
      if (c.url.includes("/settings/fields"))
        return [
          200,
          {
            fields: [
              {
                api_name: "Last_Name",
                field_label: "Last Name",
                data_type: "text",
                system_mandatory: true,
              },
              { api_name: "Email", field_label: "Email", data_type: "email" },
              { api_name: "Call_At", field_label: "Call at", data_type: "datetime" },
            ],
          },
        ];
      return [
        200,
        {
          data: [
            {
              status: "error",
              code: "INVALID_DATA",
              message: "invalid data",
              details: { api_name: "Call_At" },
            },
          ],
        },
      ];
    });
    const id = await submitted();
    await enqueueConnectorSyncs(admin, id, { fetch: app.fetcher });
    expect(await jobsFor(id)).toMatchObject([
      { status: "exhausted", last_error: "Zoho said: invalid data (Call_At)" },
    ]);
  });
});
