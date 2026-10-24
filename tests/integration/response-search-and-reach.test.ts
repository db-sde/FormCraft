import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { buildResponsesTable, getReach, listResponses } from "@/domains/responses";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";

// QA EN-01 (search) and EN-03 (drop-off by question).
const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().slice(0, 8);

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "Search" },
  theme: {
    primaryColor: "#0f172a",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "q1",
      type: "short_text",
      order: 0,
      label: "Name",
      required: true,
      settings: {},
    },
    {
      id: "q2",
      type: "long_text",
      order: 1,
      label: "Feedback",
      required: false,
      settings: {},
    },
    { id: "q3", type: "email", order: 2, label: "Email", required: false, settings: {} },
  ],
  logic: [],
};

let userId: string;
let formId: string;
let versionId: string;

async function respond(
  status: "completed" | "partial" | "in_progress",
  lastQuestionId: string | null,
  answers: Record<string, unknown>,
  extra: { is_preview?: boolean } = {},
) {
  const { data, error } = await admin
    .from("responses")
    .insert({
      form_id: formId,
      form_version_id: versionId,
      status,
      last_question_id: lastQuestionId,
      ...(status === "completed"
        ? { ending_id: "end", completed_at: new Date().toISOString() }
        : {}),
      ...extra,
    })
    .select("id")
    .single();
  if (error) throw error;
  const rows = Object.entries(answers).map(([question_id, value]) => ({
    response_id: data.id,
    question_id,
    value: value as Json,
  }));
  if (rows.length) {
    const { error: answersError } = await admin.from("answers").insert(rows);
    if (answersError) throw answersError;
  }
}

beforeAll(async () => {
  const { data: user, error } = await admin.auth.admin.createUser({
    email: `search-${runId}@example.com`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (error) throw error;
  userId = user.user.id;
  const { data: workspace } = await admin
    .from("workspaces")
    .insert({ name: "Search", slug: `search-${runId}`, owner_id: userId })
    .select("id")
    .single();
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspace!.id,
      title: "Search",
      slug: `search-${runId}`,
      created_by: userId,
    })
    .select("id")
    .single();
  formId = form!.id;
  const { data: version } = await admin
    .from("form_versions")
    .insert({
      form_id: formId,
      status: "draft",
      version_number: 1,
      schema: schema as unknown as Json,
    })
    .select("id")
    .single();
  versionId = version!.id;

  await respond("completed", "q3", {
    q1: "Ada Lovelace",
    q2: "Loved the Café crème",
    q3: "ada@example.com",
  });
  await respond("completed", "q3", { q1: "Grace", q2: "100% happy_face" });
  await respond("completed", "q3", { q1: "Alan" });
  // Unfinished: one stopped at the feedback question, one still on the first.
  await respond("partial", "q2", { q1: "Linus" });
  await respond("in_progress", "q1", {});
  // Preview traffic never counts.
  await respond("partial", "q1", { q1: "Preview" }, { is_preview: true });
}, 30_000);

afterAll(async () => {
  await admin.auth.admin.deleteUser(userId);
});

describe("searching responses", () => {
  const names = async (search: string) =>
    (await listResponses(admin, formId, { search })).items.map((i) => i.preview.q1);

  it("finds responses with any answer containing the text, ignoring case", async () => {
    expect(await names("CAFÉ")).toEqual(["Ada Lovelace"]);
    expect(await names("example.com")).toEqual(["Ada Lovelace"]);
    expect(await names("nobody")).toEqual([]);
  });

  it("takes % and _ literally", async () => {
    expect(await names("100%")).toEqual(["Grace"]);
    expect(await names("y_f")).toEqual(["Grace"]);
    expect(await names("%")).toEqual(["Grace"]);
  });

  it("exports exactly the responses the search shows", async () => {
    const { rows } = await buildResponsesTable(admin, formId, "completed", {
      search: "grace",
    });
    expect(rows.map((r) => r.Name)).toEqual(["Grace"]);
  });
});

describe("how far respondents got", () => {
  it("counts, per question, everyone who reached it and who stopped there", async () => {
    const reach = await getReach(admin, formId);
    expect(reach.starts).toBe(5);
    expect(reach.completed).toBe(3);
    expect(reach.steps.map((s) => [s.questionId, s.reached, s.stopped])).toEqual([
      ["q1", 5, 1],
      ["q2", 4, 1],
      ["q3", 3, 0],
    ]);
  });
});
