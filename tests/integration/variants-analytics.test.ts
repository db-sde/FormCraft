import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { completeResponse, startResponse } from "@/domains/responses";
import { getCrossTab } from "@/domains/responses/crosstab";
import { getFeedbackReport } from "@/domains/responses/feedback-report";
import { sendDueDigests } from "@/domains/notifications/digest";
import type { OutgoingEmail, Send } from "@/domains/notifications/mailer";
import { openVariantTest, variantResults } from "@/domains/forms/variant-tests";

/**
 * Master spec Phase 4 against the real database: variant tests (split
 * locked while running, responses tagged only by a running test), the
 * cross-tab and source filter, weekly digests, and confidential forms
 * whose individual responses no signed-in user can read.
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
  meta: { title: "Pulse" },
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
      id: "q_team",
      type: "single_select",
      order: 0,
      label: "Team",
      required: true,
      settings: {
        allowOther: false,
        options: [
          { id: "t_a", label: "Alpha" },
          { id: "t_b", label: "Beta" },
        ],
      },
    },
    {
      id: "q_nps",
      type: "opinion_scale",
      order: 1,
      label: "Recommend?",
      required: true,
      settings: { min: 0, max: 10 },
    },
    {
      id: "q_note",
      type: "long_text",
      order: 2,
      label: "Comments",
      required: false,
      settings: {},
    },
  ],
  variants: [
    {
      id: "v_b",
      name: "Shorter",
      questions: { q_nps: { label: "Would you recommend us?" } },
    },
  ],
};

let owner: Person;
let viewer: Person;
let workspaceId: string;

async function publishedForm(slug: string) {
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: slug,
      slug: `${slug}-${runId}`,
      created_by: owner.id,
    })
    .select("id")
    .single();
  await admin.from("form_versions").insert({
    form_id: form!.id,
    status: "draft",
    version_number: 1,
    schema: schema as unknown as Json,
  });
  const { error } = await admin.rpc("publish_form_version", {
    target_form_id: form!.id,
    compiled_schema: schema as unknown as Json,
  });
  if (error) throw error;
  return form!.id;
}

async function respond(
  formId: string,
  team: string,
  nps: number,
  extra: {
    utmSource?: string;
    variantTestId?: string;
    variant?: string;
    note?: string;
  } = {},
) {
  const { responseId } = await startResponse(admin, formId, extra);
  const done = await completeResponse(
    admin,
    responseId,
    1,
    "q_note",
    { q_team: team, q_nps: nps, ...(extra.note ? { q_note: extra.note } : {}) },
    crypto.randomUUID(),
  );
  if (!done.ok) throw new Error(JSON.stringify(done));
  return responseId;
}

beforeAll(async () => {
  owner = await person("p4-owner");
  viewer = await person("p4-viewer");
  const { data: ws } = await admin
    .from("workspaces")
    .insert({ name: "P4", slug: `p4-${runId}`, owner_id: owner.id })
    .select("id")
    .single();
  workspaceId = ws!.id;
  await admin.from("workspace_members").insert([
    { workspace_id: workspaceId, user_id: owner.id, role: "owner", permissions: {} },
    { workspace_id: workspaceId, user_id: viewer.id, role: "viewer", permissions: {} },
  ]);
}, 60_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", workspaceId);
  for (const p of people) await admin.auth.admin.deleteUser(p.id);
});

describe("variant tests (F-29)", () => {
  it("locks the split while running, keeps one open test, and only publishers write", async () => {
    const formId = await publishedForm("variants");
    const { error: viewerError } = await viewer.client
      .from("variant_tests")
      .insert({ form_id: formId, variant_id: "v_b", name: "x", split: 50 });
    expect(viewerError).not.toBeNull();
    const { data: test, error } = await owner.client
      .from("variant_tests")
      .insert({
        form_id: formId,
        variant_id: "v_b",
        name: "Shorter vs original",
        split: 50,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    const { error: second } = await owner.client
      .from("variant_tests")
      .insert({ form_id: formId, variant_id: "v_b", name: "Again", split: 50 });
    expect(second?.code).toBe("23505");
    const { error: locked } = await owner.client
      .from("variant_tests")
      .update({ split: 20 })
      .eq("id", test!.id);
    expect(locked?.message).toMatch(/Pause the test/);
    await owner.client
      .from("variant_tests")
      .update({ status: "paused" })
      .eq("id", test!.id);
    const { error: changed } = await owner.client
      .from("variant_tests")
      .update({ split: 20 })
      .eq("id", test!.id);
    expect(changed).toBeNull();
  });

  it("tags responses only for a running test and a real arm, and counts them per arm", async () => {
    const formId = await publishedForm("tags");
    const { data: test } = await admin
      .from("variant_tests")
      .insert({ form_id: formId, variant_id: "v_b", name: "T", split: 50 })
      .select("id")
      .single();
    const tagged = await respond(formId, "t_a", 9, {
      variantTestId: test!.id,
      variant: "v_b",
    });
    const forged = await respond(formId, "t_a", 9, {
      variantTestId: test!.id,
      variant: "v_zzz",
    });
    const original = await respond(formId, "t_b", 3, {
      variantTestId: test!.id,
      variant: "original",
    });
    const { data: rows } = await admin
      .from("responses")
      .select("id, variant, variant_test_id")
      .in("id", [tagged, forged, original]);
    const by = new Map((rows ?? []).map((r) => [r.id, r]));
    expect(by.get(tagged)).toMatchObject({ variant: "v_b", variant_test_id: test!.id });
    expect(by.get(forged)).toMatchObject({ variant: null, variant_test_id: null });
    expect(by.get(original)).toMatchObject({ variant: "original" });

    await admin.from("variant_tests").update({ status: "paused" }).eq("id", test!.id);
    const whilePaused = await respond(formId, "t_a", 9, {
      variantTestId: test!.id,
      variant: "v_b",
    });
    const { data: paused } = await admin
      .from("responses")
      .select("variant")
      .eq("id", whilePaused)
      .single();
    expect(paused?.variant).toBeNull();

    const open = await openVariantTest(owner.client, formId);
    const results = await variantResults(owner.client, open!);
    expect(results.arms.variant).toMatchObject({ started: 1, completed: 1 });
    expect(results.arms.original).toMatchObject({ started: 1, completed: 1 });
    expect(results.verdict.kind).toBe("collecting");
  });
});

describe("analytics (F-30)", () => {
  it("cross-tabs filtered responses, the source filter included", async () => {
    const formId = await publishedForm("crosstab");
    await respond(formId, "t_a", 10, { utmSource: "newsletter" });
    await respond(formId, "t_a", 2, { utmSource: "newsletter" });
    await respond(formId, "t_b", 9);
    const latest = { ...schema, variants: undefined };
    const all = await getCrossTab(owner.client, formId, latest, "q_team", "q_nps", {});
    expect(all!.responses).toBe(3);
    expect(all!.rowTotals.reduce((s, n) => s + n, 0)).toBe(3);
    const news = await getCrossTab(owner.client, formId, latest, "q_team", "q_nps", {
      source: "newsletter",
    });
    expect(news!.responses).toBe(2);
    const direct = await getCrossTab(owner.client, formId, latest, "q_team", "q_nps", {
      source: "direct",
    });
    expect(direct!.responses).toBe(1);
  });

  it("sends a weekly digest once, for the week before, with NPS", async () => {
    const formId = await publishedForm("weekly");
    await respond(formId, "t_a", 10);
    await respond(formId, "t_b", 0);
    await admin.from("notification_digests").insert({
      form_id: formId,
      member_ids: [owner.id],
      time_zone: "UTC",
      frequency: "weekly",
    });
    const sent: OutgoingEmail[] = [];
    const send: Send = async (e) => {
      sent.push(e);
      return { ok: true };
    };
    // The Monday after this week, in UTC.
    const today = new Date();
    const daysToMonday = (8 - today.getUTCDay()) % 7 || 7;
    const monday = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() + daysToMonday,
        4,
      ),
    );
    const tuesday = new Date(monday.getTime() + 86_400_000);
    await sendDueDigests(admin, { now: tuesday, send }); // not a Monday: nothing for this form
    await sendDueDigests(admin, { now: monday, send });
    await sendDueDigests(admin, { now: monday, send });
    const ours = sent.filter(
      (e) =>
        e.subject.includes("Weekly digest") && e.to.includes(owner.email.toLowerCase()),
    );
    expect(ours).toHaveLength(1);
    expect(ours[0].text).toMatch(/NPS \(Recommend\?\): 0 from 2 answers/);
  });
});

describe("confidential feedback (F-30)", () => {
  it("hides individual responses from everyone signed in, and stays confidential", async () => {
    const formId = await publishedForm("feedback");
    const { error: setError } = await owner.client
      .from("forms")
      .update({ confidential: { threshold: 3, groupQuestionId: "q_team" } as Json })
      .eq("id", formId);
    expect(setError).toBeNull();
    for (const [team, nps, note] of [
      ["t_a", 8, "Clear goals"],
      ["t_a", 6, "More focus time"],
      ["t_a", 7, "Good standups"],
      ["t_b", 2, "Too many meetings"],
    ] as const) {
      await respond(formId, team, nps, { note });
    }
    const { data: visible } = await owner.client
      .from("responses")
      .select("id")
      .eq("form_id", formId);
    expect(visible).toEqual([]);
    const { data: answers } = await owner.client
      .from("answers")
      .select("value, responses!inner(form_id)")
      .eq("responses.form_id", formId);
    expect(answers ?? []).toEqual([]);

    const report = await getFeedbackReport(admin, formId, {
      threshold: 3,
      groupQuestionId: "q_team",
    });
    expect(report).toMatchObject({ shown: true, responses: 4 });
    expect(report!.groups).toEqual([{ label: "Alpha and others", responses: 4 }]);
    expect(report!.comments[0].texts).toHaveLength(4);

    const { error: off } = await owner.client
      .from("forms")
      .update({ confidential: null })
      .eq("id", formId);
    expect(off?.message).toMatch(/stays confidential/);
    const { error: lower } = await owner.client
      .from("forms")
      .update({ confidential: { threshold: 2 } as Json })
      .eq("id", formId);
    expect(lower?.message).toMatch(/stays confidential/);
  });
});
