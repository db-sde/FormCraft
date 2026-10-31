import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { completeResponse, startResponse } from "@/domains/responses";
import { issueDocumentsForResponse, issueNumber } from "@/domains/documents/issue";
import { sendRuleEmails } from "@/domains/notifications/rules";
import { sendDueDigests } from "@/domains/notifications/digest";
import type { OutgoingEmail, Send } from "@/domains/notifications/mailer";

/**
 * Master spec Phase 3 against the real database: document numbers (per
 * form, unique, fixed), emailing at most once, certificates only on
 * their rule, rule emails and digests reaching only teammates who can
 * see responses, and who may read or change the settings.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin: SupabaseClient<Database> = createClient<Database>(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().slice(0, 8);

type Person = { id: string; email: string; client: SupabaseClient<Database> };
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
  const p = { id: data.user.id, email, client };
  people.push(p);
  return p;
}

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Safety quiz" },
  theme: {
    primaryColor: "#0f172a",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  variables: [{ id: "v_score", name: "score", type: "number", initial: 0 }],
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
      id: "q_score",
      type: "number",
      order: 2,
      label: "Score",
      required: true,
      settings: {},
    },
  ],
  logic: [],
  rules: [
    {
      id: "r_score",
      on: { event: "question_answered", questionId: "q_score" },
      then: [
        {
          type: "set_variable",
          variableId: "v_score",
          op: "set",
          value: { type: "answer", questionId: "q_score" },
        },
      ],
    },
  ],
} as unknown as FormSchemaV1;

let owner: Person;
let viewer: Person;
let blocked: Person;
let outsider: Person;
let workspaceId: string;
let formId: string;

async function respond(score: number) {
  const { responseId } = await startResponse(admin, formId);
  const done = await completeResponse(
    admin,
    responseId,
    1,
    "q_score",
    { q_name: "Grace Hopper", q_email: "grace@example.com", q_score: score },
    crypto.randomUUID(),
  );
  if (!done.ok) throw new Error(JSON.stringify(done));
  return responseId;
}

function recorder() {
  const sent: OutgoingEmail[] = [];
  const send: Send = async (email) => {
    sent.push(email);
    return { ok: true, id: "test" };
  };
  return { sent, send };
}

beforeAll(async () => {
  owner = await person("docs-owner");
  viewer = await person("docs-viewer");
  blocked = await person("docs-blocked");
  outsider = await person("docs-outsider");
  const { data: ws } = await admin
    .from("workspaces")
    .insert({ name: "Docs", slug: `docs-${runId}`, owner_id: owner.id })
    .select("id")
    .single();
  workspaceId = ws!.id;
  await admin.from("workspace_members").insert([
    { workspace_id: workspaceId, user_id: owner.id, role: "owner", permissions: {} },
    { workspace_id: workspaceId, user_id: viewer.id, role: "viewer", permissions: {} },
    {
      workspace_id: workspaceId,
      user_id: blocked.id,
      role: "editor",
      permissions: { view_responses: false },
    },
  ]);
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Safety quiz",
      slug: `quiz-${runId}`,
      created_by: owner.id,
    })
    .select("id")
    .single();
  formId = form!.id;
  await admin.from("form_versions").insert({
    form_id: formId,
    status: "draft",
    version_number: 1,
    schema: schema as unknown as Json,
  });
  const { error } = await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: schema as unknown as Json,
  });
  if (error) throw error;
}, 60_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", workspaceId);
  for (const p of people) await admin.auth.admin.deleteUser(p.id);
});

describe("document settings (RLS)", () => {
  it("editors set documents up; viewers read; outsiders see nothing", async () => {
    const { error } = await owner.client.from("form_documents").insert({
      form_id: formId,
      kind: "certificate",
      settings: {
        numberPrefix: "CERT-",
        nameQuestionId: "q_name",
        emailQuestionId: "q_email",
        condition: {
          type: "compare",
          left: { type: "variable", variableId: "v_score" },
          op: "gte",
          right: { type: "literal", value: 80 },
        },
      } as Json,
      recipients: "respondent",
      member_ids: [viewer.id, blocked.id],
    });
    expect(error).toBeNull();
    const { data: seen } = await viewer.client
      .from("form_documents")
      .select("id")
      .eq("form_id", formId);
    expect(seen).toHaveLength(1);
    const { data: changed } = await viewer.client
      .from("form_documents")
      .update({ enabled: false })
      .eq("form_id", formId)
      .select("id");
    expect(changed ?? []).toEqual([]);
    const { data: theirs } = await outsider.client
      .from("form_documents")
      .select("id")
      .eq("form_id", formId);
    expect(theirs).toEqual([]);
    // Numbers are issued by the server only.
    const { error: direct } = await owner.client.rpc("issue_response_document", {
      p_document_id: seen![0].id,
      p_response_id: crypto.randomUUID(),
    });
    expect(direct).not.toBeNull();
  });
});

describe("issuing documents (F-07)", () => {
  it("issues a certificate only on its rule, numbers it once and emails it once", async () => {
    const low = await respond(50);
    const high = await respond(92);
    const { sent, send } = recorder();
    expect(await issueDocumentsForResponse(admin, low, { send })).toEqual([]);
    const first = await issueDocumentsForResponse(admin, high, { send });
    expect(first).toEqual([{ kind: "certificate", number: 1, emailed: true }]);
    // Again (a retry or duplicate): same number, no second email.
    const again = await issueDocumentsForResponse(admin, high, { send });
    expect(again).toEqual([{ kind: "certificate", number: 1, emailed: false }]);
    expect(sent).toHaveLength(1);
    // The respondent and the viewer get it; the teammate who can't see
    // responses doesn't.
    expect(sent[0].to.sort()).toEqual(
      ["grace@example.com", viewer.email.toLowerCase()].sort(),
    );
    expect(sent[0].attachments?.[0].filename).toBe("certificate-CERT-0001.pdf");
    expect(new TextDecoder().decode(sent[0].attachments![0].content.slice(0, 5))).toBe(
      "%PDF-",
    );
    const { data: events } = await admin
      .from("response_events")
      .select("kind, outcome")
      .eq("response_id", high);
    expect(events).toEqual([{ kind: "document_emailed", outcome: "ok" }]);
  });

  it("never skips or reuses a number under racing triggers", async () => {
    const { data: doc } = await admin
      .from("form_documents")
      .insert({ form_id: formId, kind: "summary", recipients: "none" })
      .select("id")
      .single();
    const ids = await Promise.all([respond(10), respond(20), respond(30), respond(40)]);
    const numbers = await Promise.all(
      [...ids, ...ids].map((id) => issueNumber(admin, doc!.id, id)),
    );
    const byResponse = new Map<string, number>();
    numbers.forEach((n, i) => {
      const id = [...ids, ...ids][i];
      if (byResponse.has(id)) expect(byResponse.get(id)).toBe(n.number);
      byResponse.set(id, n.number);
    });
    expect([...byResponse.values()].sort()).toEqual([1, 2, 3, 4]);
  });

  it("keeps a failed send retryable and records the failure", async () => {
    const id = await respond(95);
    const failing: Send = async () => ({ ok: false });
    await issueDocumentsForResponse(admin, id, { send: failing });
    const { data: row } = await admin
      .from("response_documents")
      .select("emailed_at, form_documents!inner(kind)")
      .eq("response_id", id)
      .eq("form_documents.kind", "certificate")
      .single();
    expect(row?.emailed_at).toBeNull();
    const { data: events } = await admin
      .from("response_events")
      .select("outcome")
      .eq("response_id", id)
      .eq("kind", "document_emailed");
    expect(events).toEqual([{ outcome: "failed" }]);
  });
});

describe("notification rules and digest (F-25)", () => {
  it("emails only matching responses, only to teammates who can see responses", async () => {
    await admin.from("notification_rules").insert({
      form_id: formId,
      name: "Top scores",
      member_ids: [viewer.id, blocked.id],
      subject: "{{form}}: {{score}} from {{answer:q_name}}",
      include_answers: true,
      condition: {
        type: "compare",
        left: { type: "variable", variableId: "v_score" },
        op: "gte",
        right: { type: "literal", value: 90 },
      } as Json,
    });
    const { sent, send } = recorder();
    const low = await respond(60);
    expect(await sendRuleEmails(admin, low, { send })).toEqual([]);
    const high = await respond(97);
    const result = await sendRuleEmails(admin, high, { send });
    expect(result.map((r) => r.sent)).toEqual([true]);
    expect(sent[0].to).toEqual([viewer.email.toLowerCase()]);
    expect(sent[0].subject).toBe("Safety quiz: 97 from Grace Hopper");
    expect(sent[0].html).toContain("Grace Hopper");
  });

  it("sends one digest per day, and none for a quiet day", async () => {
    await admin.from("notification_digests").insert({
      form_id: formId,
      member_ids: [owner.id],
      time_zone: "UTC",
    });
    const { sent, send } = recorder();
    // The day after the responses above.
    const tomorrow = new Date(Date.now() + 86_400_000);
    const first = await sendDueDigests(admin, { now: tomorrow, send });
    const second = await sendDueDigests(admin, { now: tomorrow, send });
    const mine = sent.filter((e) => e.subject.includes("Safety quiz"));
    expect(mine).toHaveLength(1);
    expect(mine[0].to).toEqual([owner.email.toLowerCase()]);
    expect(first.sent).toBeGreaterThanOrEqual(1);
    expect(second.sent).toBe(0);
    // Two days later: nothing happened the day before, so nothing is sent.
    const later = await sendDueDigests(admin, {
      now: new Date(Date.now() + 3 * 86_400_000),
      send,
    });
    expect(sent.filter((e) => e.subject.includes("Safety quiz"))).toHaveLength(1);
    expect(later.sent).toBe(0);
  });
});
