import { afterAll, beforeAll, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { completeResponse, startResponse } from "@/domains/responses";
import { parseFormSchema } from "@/domains/forms/schema";
import { questionsLeftOut } from "@/domains/logic/random";

/** The server asks — and requires — the same pool questions the
 * respondent's browser showed, because both use the stored seed. */
const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().slice(0, 8);
const q = (id: string, order: number) => ({
  id,
  type: "short_text",
  order,
  label: id,
  required: true,
  settings: {},
});
const schema = parseFormSchema({
  schemaVersion: 1,
  meta: { title: "Pools" },
  theme: {},
  endings: [{ id: "end", title: "Done", isDefault: true }],
  questions: [q("a", 0), q("b", 1), q("c", 2), q("last", 3)],
  logic: [],
  pools: [{ id: "bank", questionIds: ["a", "b", "c"], pick: 1 }],
});

let userId: string;
let workspaceId: string;
let formId: string;

beforeAll(async () => {
  const { data: user } = await admin.auth.admin.createUser({
    email: `pools-${runId}@example.com`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  userId = user!.user!.id;
  const { data: ws } = await admin
    .from("workspaces")
    .insert({ name: "Pools", slug: `pools-${runId}`, owner_id: userId })
    .select("id")
    .single();
  workspaceId = ws!.id;
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Pools",
      slug: `pools-${runId}`,
      created_by: userId,
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
});

afterAll(async () => {
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

it("requires only the picked question, using the response's seed", async () => {
  const seed = "integration-seed-7";
  const [picked] = ["a", "b", "c"].filter(
    (id) => !questionsLeftOut(schema, seed).has(id),
  );
  const notPicked = ["a", "b", "c"].find((id) => id !== picked)!;

  const ok = await startResponse(admin, formId, { seed });
  expect(
    await completeResponse(
      admin,
      ok.responseId,
      1,
      "last",
      { [picked]: "x", last: "y" },
      crypto.randomUUID(),
    ),
  ).toMatchObject({ ok: true });

  // Answering a question that wasn't picked instead doesn't count.
  const wrong = await startResponse(admin, formId, { seed });
  expect(
    await completeResponse(
      admin,
      wrong.responseId,
      1,
      "last",
      { [notPicked]: "x", last: "y" },
      crypto.randomUUID(),
    ),
  ).toMatchObject({ ok: false, missingQuestionIds: [picked] });

  const { data } = await admin
    .from("responses")
    .select("random_seed")
    .eq("id", ok.responseId)
    .single();
  expect(data?.random_seed).toBe(seed);
});

it("ignores a seed in the wrong shape", async () => {
  const { responseId } = await startResponse(admin, formId, { seed: "'; drop" });
  const { data } = await admin
    .from("responses")
    .select("random_seed")
    .eq("id", responseId)
    .single();
  expect(data?.random_seed).toBeNull();
});
