import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { completeResponse, startResponse } from "@/domains/responses";
import "@/domains/connectors/registry";
import {
  dispatchConnectorJobs,
  replayJob,
  revokeConnection,
  saveConnection,
} from "@/domains/connectors/framework";
import {
  enqueueConnectorSyncs,
  recoverMissingConnectorSyncs,
} from "@/domains/connectors/links";
import { memberId } from "@/domains/connectors/providers/mailchimp";

/**
 * Master spec Phase 6 against the real database, with each app faked at
 * the fetch level: who may configure links, a sync per response that
 * retries never duplicate, conditional and consent-gated syncs, mapping
 * problems recorded on the job, token refresh, disconnecting, replay
 * after reconnecting, and the recovery sweep.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin: SupabaseClient<Database> = createClient<Database>(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().slice(0, 8);

type Person = { id: string; client: SupabaseClient<Database> };
const people: Person[] = [];
async function person(name: string): Promise<Person> {
  const email = `${name}-${runId}@example.com`;
  const password = crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false },
  });
  const { error: signIn } = await client.auth.signInWithPassword({ email, password });
  if (signIn) throw signIn;
  const p = { id: data.user.id, client };
  people.push(p);
  return p;
}

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Contact us" },
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
      id: "q_size",
      type: "number",
      order: 2,
      label: "Team size",
      required: false,
      settings: {},
    },
    {
      id: "q_ok",
      type: "yes_no",
      order: 3,
      label: "News?",
      required: false,
      settings: {},
    },
  ],
};

let ana: Person;
let viewer: Person;
let outsider: Person;
let workspaceId: string;
let formId: string;

beforeAll(async () => {
  ana = await person("cn-ana");
  viewer = await person("cn-view");
  outsider = await person("cn-out");
  const { data: ws } = await admin
    .from("workspaces")
    .insert({ name: "Apps", slug: `cn-${runId}`, owner_id: ana.id })
    .select("id")
    .single();
  workspaceId = ws!.id;
  await admin.from("workspace_members").insert([
    { workspace_id: workspaceId, user_id: ana.id, role: "owner", permissions: {} },
    { workspace_id: workspaceId, user_id: viewer.id, role: "viewer", permissions: {} },
  ]);
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Contact us",
      slug: `cn-${runId}`,
      created_by: ana.id,
    })
    .select("id")
    .single();
  formId = form!.id;
  const s = schema as unknown as Json;
  await admin
    .from("form_versions")
    .insert({ form_id: formId, status: "draft", version_number: 1, schema: s });
  const { error } = await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: s,
  });
  if (error) throw error;
}, 60_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", workspaceId);
  for (const p of people) await admin.auth.admin.deleteUser(p.id);
});

async function submitted(answers: Record<string, unknown>): Promise<string> {
  const { responseId } = await startResponse(admin, formId);
  const done = await completeResponse(
    admin,
    responseId,
    1,
    "q_ok",
    answers as never,
    crypto.randomUUID(),
  );
  expect(done.ok).toBe(true);
  return responseId;
}

/** A fake app: answers by method + URL pattern, recording each call. */
function fakeApp(
  routes: [string, RegExp, (body: unknown, call: number) => [number, unknown]][],
) {
  const calls: { method: string; url: string; auth: string; body: unknown }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string" ? safeJson(init.body) : (init?.body ?? null);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ method, url: u, auth: headers.authorization ?? "", body });
    const route = routes.find(([m, re]) => m === method && re.test(u));
    if (!route)
      return new Response(JSON.stringify({ error: "no route" }), { status: 404 });
    const n = calls.filter((c) => c.method === method && route[1].test(c.url)).length;
    const [status, data] = route[2](body, n);
    return new Response(status === 204 ? null : JSON.stringify(data), { status });
  }) as typeof fetch;
  return { fetcher, calls };
}
const safeJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

async function link(
  provider: string,
  settings: Record<string, unknown>,
  mapping: unknown[],
  condition: unknown = null,
) {
  await admin.from("connector_links").delete().eq("form_id", formId);
  const { data, error } = await ana.client
    .from("connector_links")
    .insert({
      form_id: formId,
      provider,
      settings: settings as Json,
      mapping: mapping as Json,
      condition: condition as Json,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function jobsFor(responseId: string) {
  const { data } = await admin
    .from("connector_jobs")
    .select("id, status, last_error, attempt_count, result, idempotency_key")
    .eq("response_id", responseId);
  return data ?? [];
}

const AIRTABLE_TABLE = {
  tables: [
    {
      id: "tblX",
      name: "Leads",
      fields: [
        { id: "fldResp", name: "Response", type: "singleLineText" },
        { id: "fldName", name: "Name", type: "singleLineText" },
        { id: "fldSize", name: "Size", type: "number" },
        { id: "fldNews", name: "News", type: "checkbox" },
        { id: "fldTotal", name: "Total", type: "formula" },
      ],
    },
  ],
};

describe("who can configure apps", () => {
  it("lets integration managers write links, members read them, outsiders nothing", async () => {
    await link(
      "airtable",
      { baseId: "app1", tableId: "tblX", matchField: "fldResp" },
      [],
    );
    const { error } = await viewer.client
      .from("connector_links")
      .update({ enabled: false })
      .eq("form_id", formId)
      .select("id")
      .single();
    expect(error).not.toBeNull();
    const { data: seen } = await viewer.client
      .from("connector_links")
      .select("id")
      .eq("form_id", formId);
    expect(seen).toHaveLength(1);
    const { data: none } = await outsider.client
      .from("connector_links")
      .select("id")
      .eq("form_id", formId);
    expect(none).toEqual([]);
    // Connections and their tokens are never readable by clients.
    const { data: tokens } = await ana.client.from("connector_connections").select("*");
    expect(tokens ?? []).toEqual([]);
  });
});

describe("Airtable (F-33)", () => {
  let connectionId: string;
  beforeAll(async () => {
    connectionId = await saveConnection(admin, {
      workspaceId,
      userId: null,
      provider: "airtable",
      tokens: { accessToken: "air-token" },
      label: "ana@example.com",
      createdBy: ana.id,
    });
  });

  it("upserts one record per response on the response ID field; retries and replays don't duplicate", async () => {
    await link("airtable", { baseId: "app1", tableId: "tblX", matchField: "fldResp" }, [
      { field: "fldName", source: "answer:q_name" },
      { field: "fldSize", source: "answer:q_size" },
      { field: "fldNews", source: "answer:q_ok" },
    ]);
    const app = fakeApp([
      ["GET", /meta\/bases\/app1\/tables$/, () => [200, AIRTABLE_TABLE]],
      [
        "PATCH",
        /v0\/app1\/tblX$/,
        () => [200, { records: [{ id: "rec1" }], createdRecords: ["rec1"] }],
      ],
    ]);
    const id = await submitted({
      q_name: "Ada",
      q_email: "ada@example.com",
      q_size: 12,
      q_ok: true,
    });
    expect(await enqueueConnectorSyncs(admin, id, { fetch: app.fetcher })).toBe(1);
    // A repeat (a second submit, the recovery sweep) queues nothing new.
    await enqueueConnectorSyncs(admin, id, { fetch: app.fetcher });
    const jobs = await jobsFor(id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      status: "succeeded",
      result: { recordId: "rec1", created: true },
    });
    const patch = app.calls.find((c) => c.method === "PATCH")!;
    expect(patch.auth).toBe("Bearer air-token");
    expect(patch.body).toMatchObject({
      performUpsert: { fieldsToMergeOn: ["fldResp"] },
      records: [{ fields: { fldResp: id, fldName: "Ada", fldSize: 12, fldNews: true } }],
    });
    // Sending again by hand isn't offered for a success.
    expect(await replayJob(admin, jobs[0].id)).toBe(false);
  });

  it("retries a provider outage with backoff, then succeeds", async () => {
    await link("airtable", { baseId: "app1", tableId: "tblX", matchField: "fldResp" }, [
      { field: "fldName", source: "answer:q_name" },
    ]);
    const app = fakeApp([
      ["GET", /meta\/bases\/app1\/tables$/, () => [200, AIRTABLE_TABLE]],
      [
        "PATCH",
        /v0\/app1\/tblX$/,
        (_, n) =>
          n === 1
            ? [503, { error: { message: "down" } }]
            : [200, { records: [{ id: "rec2" }] }],
      ],
    ]);
    const id = await submitted({ q_name: "Bo", q_email: "bo@example.com" });
    await enqueueConnectorSyncs(admin, id, { fetch: app.fetcher });
    let [job] = await jobsFor(id);
    expect(job).toMatchObject({ status: "failed", attempt_count: 1 });
    expect(job.last_error).toMatch(/HTTP 503: down/);
    await admin
      .from("connector_jobs")
      .update({ next_attempt_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", job.id);
    await dispatchConnectorJobs(admin, { fetch: app.fetcher });
    [job] = await jobsFor(id);
    expect(job.status).toBe("succeeded");
    // Both attempts upserted on the same key: no second record.
    const bodies = app.calls
      .filter((c) => c.method === "PATCH")
      .map((c) => c.body as { performUpsert: unknown });
    expect(
      bodies.every(
        (b) => JSON.stringify(b.performUpsert) === '{"fieldsToMergeOn":["fldResp"]}',
      ),
    ).toBe(true);
  });

  it("records mapping problems on the job instead of retrying", async () => {
    await link("airtable", { baseId: "app1", tableId: "tblX", matchField: "fldResp" }, [
      { field: "fldTotal", source: "answer:q_name" },
      { field: "fldSize", source: "answer:q_name" },
    ]);
    const app = fakeApp([
      ["GET", /meta\/bases\/app1\/tables$/, () => [200, AIRTABLE_TABLE]],
    ]);
    const id = await submitted({ q_name: "Cy", q_email: "cy@example.com" });
    await enqueueConnectorSyncs(admin, id, { fetch: app.fetcher });
    const [job] = await jobsFor(id);
    expect(job.status).toBe("exhausted");
    expect(job.last_error).toContain('"Total" (formula) can\'t be filled');
    expect(job.last_error).toContain('"Size" needs a number');
    expect(app.calls.some((c) => c.method === "PATCH")).toBe(false);
    // A failure can be sent again by hand: same row, same key.
    expect(await replayJob(admin, job.id)).toBe(true);
    expect((await jobsFor(id))[0].status).toBe("pending");
  });

  it("skips responses that don't match the link's condition, saying why", async () => {
    await link(
      "airtable",
      { baseId: "app1", tableId: "tblX", matchField: "fldResp" },
      [{ field: "fldName", source: "answer:q_name" }],
      {
        type: "all",
        conditions: [
          {
            type: "compare",
            left: { type: "answer", questionId: "q_size" },
            op: "gte",
            right: { type: "literal", value: 10 },
          },
        ],
      },
    );
    const app = fakeApp([]);
    const id = await submitted({ q_name: "Di", q_email: "di@example.com", q_size: 3 });
    expect(await enqueueConnectorSyncs(admin, id, { fetch: app.fetcher })).toBe(0);
    expect(await jobsFor(id)).toMatchObject([
      { status: "skipped", last_error: "Its condition didn't match this response" },
    ]);
    expect(app.calls).toEqual([]);
  });

  it("stops syncing when disconnected, and sends skipped syncs after reconnecting", async () => {
    await link("airtable", { baseId: "app1", tableId: "tblX", matchField: "fldResp" }, [
      { field: "fldName", source: "answer:q_name" },
    ]);
    await revokeConnection(admin, connectionId);
    const { data: wiped } = await admin
      .from("connector_connections")
      .select("status")
      .eq("id", connectionId)
      .single();
    expect(wiped?.status).toBe("revoked");
    const app = fakeApp([
      ["GET", /meta\/bases\/app1\/tables$/, () => [200, AIRTABLE_TABLE]],
      ["PATCH", /v0\/app1\/tblX$/, () => [200, { records: [{ id: "rec9" }] }]],
    ]);
    const id = await submitted({ q_name: "Ed", q_email: "ed@example.com" });
    await enqueueConnectorSyncs(admin, id, { fetch: app.fetcher });
    const [job] = await jobsFor(id);
    expect(job).toMatchObject({ status: "skipped", last_error: "Disconnected" });
    expect(app.calls).toEqual([]);
    expect(await replayJob(admin, job.id)).toBe(false); // still disconnected

    await saveConnection(admin, {
      workspaceId,
      userId: null,
      provider: "airtable",
      tokens: { accessToken: "air-token-2" },
      label: null,
      createdBy: ana.id,
    });
    expect(await replayJob(admin, job.id)).toBe(true);
    await dispatchConnectorJobs(admin, { fetch: app.fetcher });
    expect((await jobsFor(id))[0].status).toBe("succeeded");
    expect(app.calls.find((c) => c.method === "PATCH")?.auth).toBe("Bearer air-token-2");
  });

  it("queues syncs a killed request missed", async () => {
    await link(
      "airtable",
      { baseId: "app1", tableId: "tblX", matchField: "fldResp" },
      [],
    );
    const id = await submitted({ q_name: "Flo", q_email: "flo@example.com" });
    // The link predates the response; the response is a few minutes old.
    await admin
      .from("connector_links")
      .update({ created_at: new Date(Date.now() - 3_600_000).toISOString() })
      .eq("form_id", formId);
    await admin
      .from("responses")
      .update({ completed_at: new Date(Date.now() - 5 * 60_000).toISOString() })
      .eq("id", id);
    expect(await jobsFor(id)).toEqual([]);
    const { recovered } = await recoverMissingConnectorSyncs(admin);
    expect(recovered).toBeGreaterThanOrEqual(1);
    expect((await jobsFor(id))[0]?.status).toBe("pending");
    expect((await recoverMissingConnectorSyncs(admin)).recovered).toBe(0);
  });
});

describe("Mailchimp (F-38)", () => {
  beforeAll(async () => {
    await saveConnection(admin, {
      workspaceId,
      userId: null,
      provider: "mailchimp",
      tokens: { accessToken: "mc-token" },
      label: "Acme",
      settings: { dc: "us7" },
      createdBy: ana.id,
    });
  });

  it("adds only people who consented, as pending for double opt-in, with tags", async () => {
    await link(
      "mailchimp",
      {
        audienceId: "aud1",
        emailSource: "answer:q_email",
        consentQuestionId: "q_ok",
        doubleOptIn: true,
        tags: ["webinar"],
      },
      [{ field: "FNAME", source: "answer:q_name" }],
    );
    const app = fakeApp([
      [
        "PUT",
        /us7\.api\.mailchimp\.com\/3\.0\/lists\/aud1\/members\/[0-9a-f]{32}$/,
        () => [200, { status: "pending" }],
      ],
      ["POST", /\/tags$/, () => [204, null]],
    ]);
    const no = await submitted({
      q_name: "Gil",
      q_email: "gil@example.com",
      q_ok: false,
    });
    await enqueueConnectorSyncs(admin, no, { fetch: app.fetcher });
    expect(await jobsFor(no)).toMatchObject([
      { status: "skipped", last_error: "No marketing consent" },
    ]);
    expect(app.calls).toEqual([]);

    const yes = await submitted({
      q_name: "Hal",
      q_email: "Hal@Example.com",
      q_ok: true,
    });
    await enqueueConnectorSyncs(admin, yes, { fetch: app.fetcher });
    expect((await jobsFor(yes))[0].status).toBe("succeeded");
    const put = app.calls.find((c) => c.method === "PUT")!;
    expect(put.url).toContain(`/members/${memberId("hal@example.com")}`);
    expect(put.body).toEqual({
      email_address: "hal@example.com",
      status_if_new: "pending",
      merge_fields: { FNAME: "Hal" },
    });
    expect(app.calls.find((c) => c.method === "POST")?.body).toEqual({
      tags: [{ name: "webinar", status: "active" }],
    });
  });
});

describe("Salesforce (F-34)", () => {
  const env = { ...process.env };
  afterAll(() => {
    process.env = { ...env };
  });

  it("refreshes a refused token once, then updates the lead matched by email", async () => {
    process.env.SALESFORCE_CLIENT_ID = "sf-id";
    process.env.SALESFORCE_CLIENT_SECRET = "sf-secret";
    await saveConnection(admin, {
      workspaceId,
      userId: null,
      provider: "salesforce",
      tokens: {
        accessToken: "old",
        refreshToken: "sf-refresh",
        extra: { instance_url: "https://acme.my.salesforce.com" },
      },
      label: null,
      createdBy: ana.id,
    });
    await link("salesforce", { object: "Lead", dedupe: "email", assignmentRules: true }, [
      { field: "LastName", source: "answer:q_name" },
      { field: "Email", source: "answer:q_email" },
      { field: "Company", source: "text:Website" },
    ]);
    const describe = {
      fields: [
        {
          name: "LastName",
          label: "Last Name",
          type: "string",
          createable: true,
          updateable: true,
          nillable: false,
          defaultedOnCreate: false,
          externalId: false,
        },
        {
          name: "Company",
          label: "Company",
          type: "string",
          createable: true,
          updateable: true,
          nillable: false,
          defaultedOnCreate: false,
          externalId: false,
        },
        {
          name: "Email",
          label: "Email",
          type: "email",
          createable: true,
          updateable: true,
          nillable: true,
          defaultedOnCreate: false,
          externalId: false,
        },
      ],
    };
    const calls: {
      method: string;
      url: string;
      auth: string;
      headers: Record<string, string>;
      body: unknown;
    }[] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({
        method: init?.method ?? "GET",
        url: u,
        auth: headers.authorization ?? "",
        headers,
        body: init?.body,
      });
      if (u.includes("/oauth2/token"))
        return new Response(JSON.stringify({ access_token: "new" }), { status: 200 });
      if (headers.authorization === "Bearer old")
        return new Response(
          JSON.stringify([
            { message: "Session expired", errorCode: "INVALID_SESSION_ID" },
          ]),
          { status: 401 },
        );
      if (u.endsWith("/describe"))
        return new Response(JSON.stringify(describe), { status: 200 });
      if (u.includes("/query?"))
        return new Response(JSON.stringify({ records: [{ Id: "00Q1" }] }), {
          status: 200,
        });
      if (u.endsWith("/sobjects/Lead/00Q1")) return new Response(null, { status: 204 });
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    const id = await submitted({ q_name: "Ivy O'Neil", q_email: "ivy@example.com" });
    await enqueueConnectorSyncs(admin, id, { fetch: fetcher });
    expect(await jobsFor(id)).toMatchObject([
      { status: "succeeded", last_error: null, result: { id: "00Q1", created: false } },
    ]);
    const query = calls.find((c) => c.url.includes("/query?"))!;
    expect(decodeURIComponent(query.url)).toContain(
      "WHERE Email = 'ivy@example.com' AND IsConverted = false",
    );
    const update = calls.find((c) => c.method === "PATCH")!;
    expect(update.auth).toBe("Bearer new");
    expect(update.headers["sforce-auto-assign"]).toBe("TRUE");
    expect(JSON.parse(String(update.body))).toEqual({
      LastName: "Ivy O'Neil",
      Email: "ivy@example.com",
      Company: "Website",
    });
    expect(
      calls.some((c) => c.method === "POST" && c.url.endsWith("/sobjects/Lead")),
    ).toBe(false);
  });
});

describe("Pipedrive (F-40)", () => {
  it("marks the connection for reconnecting when the token is refused", async () => {
    await saveConnection(admin, {
      workspaceId,
      userId: null,
      provider: "pipedrive",
      tokens: { accessToken: "pd", extra: { api_domain: "https://acme.pipedrive.com" } },
      label: null,
      createdBy: ana.id,
    });
    await link("pipedrive", { target: "lead" }, [
      { field: "name", source: "answer:q_name" },
      { field: "email", source: "answer:q_email" },
    ]);
    const app = fakeApp([
      [
        "GET",
        /personFields/,
        () => [401, { success: false, error: "unauthorized access" }],
      ],
    ]);
    const id = await submitted({ q_name: "Jo", q_email: "jo@example.com" });
    await enqueueConnectorSyncs(admin, id, { fetch: app.fetcher });
    expect((await jobsFor(id))[0]).toMatchObject({ status: "exhausted" });
    const { data } = await admin
      .from("connector_connections")
      .select("status")
      .eq("workspace_id", workspaceId)
      .eq("provider", "pipedrive")
      .single();
    expect(data?.status).toBe("invalid");
  });

  it("finds the person by email and makes one lead per response", async () => {
    await saveConnection(admin, {
      workspaceId,
      userId: null,
      provider: "pipedrive",
      tokens: { accessToken: "pd2", extra: { api_domain: "https://acme.pipedrive.com" } },
      label: null,
      createdBy: ana.id,
    });
    const leads: { id: string; title: string }[] = [];
    const app = fakeApp([
      [
        "GET",
        /personFields/,
        () => [
          200,
          {
            data: [
              { key: "name", name: "Name", field_type: "varchar" },
              { key: "email", name: "Email", field_type: "varchar" },
            ],
          },
        ],
      ],
      [
        "GET",
        /persons\/search/,
        () => [200, { data: { items: [{ item: { id: 42 } }] } }],
      ],
      ["PUT", /persons\/42$/, () => [200, { data: { id: 42 } }]],
      ["GET", /leads\?person_id=42/, () => [200, { data: leads }]],
      [
        "POST",
        /\/leads$/,
        (body) => {
          leads.push({
            id: `l${leads.length + 1}`,
            title: (body as { title: string }).title,
          });
          return [201, { data: { id: `l${leads.length}` } }];
        },
      ],
    ]);
    const id = await submitted({ q_name: "Kai", q_email: "kai@example.com" });
    await enqueueConnectorSyncs(admin, id, { fetch: app.fetcher });
    const [job] = await jobsFor(id);
    expect(job).toMatchObject({
      status: "succeeded",
      result: { personId: 42, created: false, leadId: "l1" },
    });
    // Run the same job again (a retry after a timeout): no second lead.
    await admin
      .from("connector_jobs")
      .update({
        status: "pending",
        next_attempt_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .eq("id", job.id);
    await dispatchConnectorJobs(admin, { fetch: app.fetcher });
    expect(leads).toHaveLength(1);
    expect(app.calls.find((c) => c.method === "PUT")?.body).toEqual({ name: "Kai" });
  });
});
