import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { completeResponse, startResponse } from "@/domains/responses";
import {
  listLookups,
  lookupPlan,
  LookupError,
  MAX_CALLS_PER_RESPONSE,
  runLookups,
  saveLookup,
} from "@/domains/integrations/lookups";

/** Data lookups (logic spec phase 24) against the real database and a
 * local API: what's sent, what's kept, the limits, and that the server's
 * own walk uses the looked-up value — not anything from the browser. */
const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().slice(0, 8);

const schema = {
  schemaVersion: 1,
  meta: { title: "Qualify" },
  theme: {},
  endings: [
    { id: "small", title: "Self-serve", isDefault: true },
    { id: "big", title: "Talk to sales" },
  ],
  hiddenFields: [{ name: "company_size" }, { name: "company_name" }, { name: "source" }],
  questions: [
    {
      id: "mail",
      type: "email",
      order: 0,
      label: "Work email",
      required: true,
      settings: {},
    },
    { id: "note", type: "short_text", order: 1, label: "Anything else?", settings: {} },
  ],
  logic: [],
  rules: [
    {
      id: "r_big",
      on: { event: "form_completed" },
      when: {
        type: "compare",
        left: { type: "hidden", name: "company_size" },
        op: "gt",
        right: { type: "literal", value: 100 },
      },
      then: [{ type: "jump_to_ending", endingId: "big" }],
    },
  ],
} as unknown as Json;

let api: Server;
let base: string;
let calls: { url: string; headers: IncomingMessage["headers"] }[] = [];
let reply: (url: URL) => {
  status?: number;
  body: string;
  headers?: Record<string, string>;
};
let userId: string;
let workspaceId: string;
let formId: string;

const okReply = () => ({
  body: JSON.stringify({
    company: { name: "Analytical Engines", employees: 250, secret: "internal-note" },
  }),
});

beforeAll(async () => {
  api = createServer((req, res) => {
    calls.push({ url: req.url ?? "", headers: req.headers });
    const out = reply(new URL(req.url ?? "/", "http://127.0.0.1"));
    res.writeHead(out.status ?? 200, {
      "content-type": "application/json",
      ...out.headers,
    });
    res.end(out.body);
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

  const { data: user } = await admin.auth.admin.createUser({
    email: `lookup-${runId}@example.com`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  userId = user!.user!.id;
  const { data: ws } = await admin
    .from("workspaces")
    .insert({
      name: "Lookups",
      slug: `lookup-${runId}`,
      owner_id: userId,
      plan_id: "business",
    })
    .select("id")
    .single();
  workspaceId = ws!.id;
  await admin.from("workspaces").update({ plan_id: "business" }).eq("id", workspaceId);
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Qualify",
      slug: `lookup-${runId}`,
      created_by: userId,
    })
    .select("id")
    .single();
  formId = form!.id;
  await admin
    .from("form_versions")
    .insert({ form_id: formId, status: "draft", version_number: 1, schema });
  const { error } = await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: schema,
  });
  if (error) throw error;
});

afterAll(async () => {
  await new Promise((resolve) => api.close(resolve));
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

beforeEach(() => {
  calls = [];
  reply = okReply;
});

const hiddenOf = async (responseId: string) =>
  (
    await admin
      .from("responses")
      .select("hidden_fields, lookup_calls")
      .eq("id", responseId)
      .single()
  ).data!;

describe("data lookups", () => {
  it("are saved with the secret encrypted, and refuse unsafe settings", async () => {
    const input = {
      name: "Company",
      triggerQuestionId: "mail",
      url: `${base}/companies?email={{answer:mail}}`,
      headerName: "X-Api-Key",
      headerValue: "s3cret-key-value",
      outputs: [
        { field: "company_size", path: "company.employees" },
        { field: "company_name", path: "company.name" },
        // Not a URL field of the form: never written.
        { field: "undeclared", path: "company.secret" },
      ],
    };
    await expect(
      saveLookup(
        admin,
        formId,
        { ...input, url: "https://10.0.0.8/x" },
        { createdBy: userId },
      ),
    ).rejects.toBeInstanceOf(LookupError);
    await expect(
      saveLookup(admin, formId, { ...input, headerName: "Host" }, { createdBy: userId }),
    ).rejects.toThrow("can't be set");
    await expect(
      saveLookup(admin, formId, { ...input, headerValue: null }, { createdBy: userId }),
    ).rejects.toThrow("header's value");

    await saveLookup(admin, formId, input, { createdBy: userId });
    const { data: stored } = await admin
      .from("form_lookups")
      .select("encrypted_header")
      .eq("form_id", formId)
      .single();
    expect(JSON.stringify(stored)).not.toContain("s3cret-key-value");
    const listed = await listLookups(admin, formId);
    expect(JSON.stringify(listed)).not.toContain("s3cret");
    expect(listed[0]).toMatchObject({ name: "Company", headerName: "X-Api-Key" });
    expect(await lookupPlan(admin, formId)).toEqual({
      triggers: ["mail"],
      fields: ["company_size", "company_name", "undeclared"],
    });
  });

  it("call the API with the header and the encoded answer, and keep declared fields", async () => {
    // A value for a looked-up field in the respondent's URL is dropped.
    const { responseId } = await startResponse(admin, formId, {
      hidden: { company_size: "99999", source: "ad" },
    });
    expect((await hiddenOf(responseId)).hidden_fields).toEqual({ source: "ad" });

    const answers = { mail: "ada+x@example.com", stray: "ignored" };
    expect(await runLookups(admin, responseId, "note", answers)).toEqual({});
    expect(calls).toHaveLength(0);

    expect(await runLookups(admin, responseId, "mail", answers)).toEqual({
      company_size: "250",
      company_name: "Analytical Engines",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/companies?email=ada%2Bx%40example.com");
    expect(calls[0].headers["x-api-key"]).toBe("s3cret-key-value");
    expect(await hiddenOf(responseId)).toEqual({
      hidden_fields: {
        source: "ad",
        company_size: "250",
        company_name: "Analytical Engines",
      },
      lookup_calls: 1,
    });

    // The server's walk reads the stored value: 250 > 100 → sales.
    const done = await completeResponse(
      admin,
      responseId,
      1,
      "note",
      { mail: "ada+x@example.com" },
      crypto.randomUUID(),
    );
    expect(done).toMatchObject({ ok: true, endingId: "big" });
    // Submitted: no more lookups.
    expect(await runLookups(admin, responseId, "mail", answers)).toEqual({});
    expect(calls).toHaveLength(1);
  });

  it("carry on without values when the API fails, redirects, is too big or isn't JSON", async () => {
    const { responseId } = await startResponse(admin, formId);
    const run = () => runLookups(admin, responseId, "mail", { mail: "a@b.co" });

    reply = () => ({ status: 500, body: "{}" });
    expect(await run()).toEqual({});
    reply = () => ({
      status: 302,
      body: "",
      headers: { location: "http://127.0.0.1:1/elsewhere" },
    });
    expect(await run()).toEqual({});
    reply = () => ({ body: JSON.stringify({ company: { name: "x".repeat(70_000) } }) });
    expect(await run()).toEqual({});
    reply = () => ({ body: "<html>not json</html>" });
    expect(await run()).toEqual({});
    reply = () => ({ body: JSON.stringify({ company: { employees: { nested: 1 } } }) });
    expect(await run()).toEqual({});
    expect((await hiddenOf(responseId)).hidden_fields).toEqual({});

    // Without a value the default ending applies.
    const done = await completeResponse(
      admin,
      responseId,
      1,
      "note",
      { mail: "a@b.co" },
      crypto.randomUUID(),
    );
    expect(done).toMatchObject({ ok: true, endingId: "small" });
  });

  it("stop at the per-response cap and when the plan no longer includes them", async () => {
    const { responseId } = await startResponse(admin, formId);
    const run = () => runLookups(admin, responseId, "mail", { mail: "a@b.co" });
    for (let i = 0; i < MAX_CALLS_PER_RESPONSE; i += 1) await run();
    expect(calls).toHaveLength(MAX_CALLS_PER_RESPONSE);
    expect(await run()).toEqual({});
    expect(calls).toHaveLength(MAX_CALLS_PER_RESPONSE);

    const { responseId: other } = await startResponse(admin, formId);
    await admin.from("workspaces").update({ plan_id: "pro" }).eq("id", workspaceId);
    expect(await runLookups(admin, other, "mail", { mail: "a@b.co" })).toEqual({});
    expect(calls).toHaveLength(MAX_CALLS_PER_RESPONSE);
    await admin.from("workspaces").update({ plan_id: "business" }).eq("id", workspaceId);
  });
});
