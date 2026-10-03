import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { parseFormSchema } from "@/domains/forms/schema";
import { completeResponse, startResponse } from "@/domains/responses";
import {
  knownAnswersFor,
  profileKeyFromLabel,
  purgeStaleProfiles,
  rememberProfile,
} from "@/domains/responses/profile";
import { deletePersonData } from "@/domains/responses/privacy";

/** Progressive profiling (logic spec phase 23) against the real
 * database: what a visitor told one form is offered to another form in
 * the same workspace only — for the same kind of question, while still
 * valid — and can be forgotten. */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const runId = crypto.randomUUID().slice(0, 8);
const visitor = `visitor-${crypto.randomUUID()}`;

const first = {
  schemaVersion: 1,
  meta: { title: "First" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "mail",
      type: "email",
      order: 0,
      label: "Email",
      required: true,
      settings: {},
      profileKey: "email",
    },
    {
      id: "co",
      type: "short_text",
      order: 1,
      label: "Company",
      settings: {},
      profileKey: "company",
    },
    {
      id: "size",
      type: "number",
      order: 2,
      label: "Team size",
      settings: {},
      profileKey: "team_size",
    },
    { id: "note", type: "short_text", order: 3, label: "Note", settings: {} },
  ],
  logic: [],
} as unknown as Json;
const second = {
  schemaVersion: 1,
  meta: { title: "Second" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "q_company",
      type: "short_text",
      order: 0,
      label: "Your company",
      settings: {},
      profileKey: "company",
    },
    // Same key, another kind of question: not reused.
    {
      id: "q_email",
      type: "short_text",
      order: 1,
      label: "Email",
      settings: {},
      profileKey: "email",
    },
    // Same key, but the remembered value is no longer a valid answer.
    {
      id: "q_size",
      type: "number",
      order: 2,
      label: "Team size",
      settings: { max: 10 },
      profileKey: "team_size",
    },
    { id: "q_other", type: "short_text", order: 3, label: "Other", settings: {} },
  ],
  logic: [],
} as unknown as Json;

let ownerId: string;
let workspaceId: string;
let otherWorkspaceId: string;
let firstForm: string;

async function publish(ws: string, title: string, schema: Json): Promise<string> {
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: ws,
      title,
      slug: `pp-${title.toLowerCase()}-${runId}`,
      created_by: ownerId,
    })
    .select("id")
    .single();
  await admin
    .from("form_versions")
    .insert({ form_id: form!.id, status: "draft", version_number: 1, schema });
  const { error } = await admin.rpc("publish_form_version", {
    target_form_id: form!.id,
    compiled_schema: schema,
  });
  if (error) throw error;
  return form!.id;
}

beforeAll(async () => {
  const { data: user } = await admin.auth.admin.createUser({
    email: `pp-${runId}@example.com`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  ownerId = user!.user!.id;
  const make = async (name: string) =>
    (
      await admin
        .from("workspaces")
        .insert({ name, slug: `pp-${name.toLowerCase()}-${runId}`, owner_id: ownerId })
        .select("id")
        .single()
    ).data!.id;
  workspaceId = await make("Main");
  otherWorkspaceId = await make("Other");
  for (const ws of [workspaceId, otherWorkspaceId])
    await admin
      .from("workspace_members")
      .insert({ workspace_id: ws, user_id: ownerId, role: "owner" });
  firstForm = await publish(workspaceId, "First", first);
});

afterAll(async () => {
  for (const ws of [workspaceId, otherWorkspaceId])
    if (ws) await admin.from("workspaces").delete().eq("id", ws);
  if (ownerId) await admin.auth.admin.deleteUser(ownerId);
});

describe("progressive profiling", () => {
  it("suggests a key from a label", () => {
    expect(profileKeyFromLabel("Company name?")).toBe("company_name");
    expect(profileKeyFromLabel("1. Your e-mail")).toBe("your_e_mail");
    expect(profileKeyFromLabel("¿?")).toBe("detail");
  });

  it("remembers answers on submit and offers them where they still fit", async () => {
    const { responseId } = await startResponse(admin, firstForm, { visitorId: visitor });
    // Nothing is remembered until the response is submitted.
    expect(await rememberProfile(admin, responseId)).toBe(0);
    await completeResponse(
      admin,
      responseId,
      1,
      "note",
      { mail: "ada@example.com", co: "Analytical Engines", size: 40, note: "hi" },
      crypto.randomUUID(),
    );
    expect(await rememberProfile(admin, responseId)).toBe(3);

    const schema = parseFormSchema(second);
    expect(await knownAnswersFor(admin, workspaceId, visitor, schema)).toEqual({
      q_company: "Analytical Engines",
    });
    // Another browser, or another workspace, knows nothing.
    expect(
      await knownAnswersFor(admin, workspaceId, `visitor-${crypto.randomUUID()}`, schema),
    ).toEqual({});
    expect(await knownAnswersFor(admin, otherWorkspaceId, visitor, schema)).toEqual({});

    // All three details were remembered, under their keys.
    const { data: profiles } = await admin
      .from("visitor_profiles")
      .select("key")
      .eq("visitor_id", visitor);
    expect(profiles?.map((p) => p.key).sort()).toEqual(["company", "email", "team_size"]);
  });

  it("records the visitor only on forms that use it", async () => {
    const plain = await publish(workspaceId, "Plain", {
      ...(first as Record<string, unknown>),
      questions: [
        { id: "note", type: "short_text", order: 0, label: "Note", settings: {} },
      ],
    } as Json);
    const { responseId } = await startResponse(admin, plain, { visitorId: visitor });
    const { data } = await admin
      .from("responses")
      .select("visitor_id")
      .eq("id", responseId)
      .single();
    expect(data?.visitor_id).toBeNull();
  });

  it("forgets on a privacy request and after a year", async () => {
    const stale = `visitor-${crypto.randomUUID()}`;
    await admin.from("visitor_profiles").insert({
      workspace_id: workspaceId,
      visitor_id: stale,
      key: "company",
      value: "Old Co",
      question_type: "short_text",
      updated_at: new Date(Date.now() - 400 * 86_400_000).toISOString(),
    });
    expect(await purgeStaleProfiles(admin)).toBeGreaterThanOrEqual(1);
    const remaining = async (id: string) =>
      (await admin.from("visitor_profiles").select("key").eq("visitor_id", id)).data
        ?.length;
    expect(await remaining(stale)).toBe(0);
    expect(await remaining(visitor)).toBe(3);

    // Erasing the person's responses also forgets their browser.
    expect(await deletePersonData(admin, admin, workspaceId, "ada@example.com")).toEqual({
      found: 1,
      deleted: 1,
    });
    expect(await remaining(visitor)).toBe(0);
  });
});
