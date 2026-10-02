import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { getPublicFormBySlug } from "@/domains/forms";
import {
  completeResponse,
  saveResponseAnswers,
  startResponse,
} from "@/domains/responses";
import {
  createResumeLink,
  resolveResumeToken,
  ResumeUnavailableError,
} from "@/domains/responses/resume";

/** Resume links (P2.8) against the real database. */
const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().slice(0, 8);

const schema = {
  schemaVersion: 1,
  meta: { title: "Resume" },
  theme: {},
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
      type: "short_text",
      order: 1,
      label: "Team",
      required: true,
      settings: {},
    },
    {
      id: "q3",
      type: "short_text",
      order: 2,
      label: "Notes",
      required: false,
      settings: {},
    },
  ],
  logic: [],
} as unknown as Json;

let userId: string;
let workspaceId: string;
const slug = `resume-${runId}`;
let formId: string;

const tokenOf = (path: string) => new URL(path, "http://x").searchParams.get("resume")!;
const publicForm = async () => (await getPublicFormBySlug(admin, slug))!;

async function publish() {
  const { error } = await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: schema,
  });
  if (error) throw error;
}

async function unfinished() {
  const { responseId } = await startResponse(admin, formId);
  await saveResponseAnswers(admin, responseId, 1, "q2", { q1: "Ada" });
  return responseId;
}

beforeAll(async () => {
  const { data: user, error } = await admin.auth.admin.createUser({
    email: `resume-${runId}@example.com`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (error) throw error;
  userId = user.user.id;
  const { data: workspace } = await admin
    .from("workspaces")
    .insert({ name: "Resume", slug: `resume-${runId}`, owner_id: userId })
    .select("id")
    .single();
  workspaceId = workspace!.id;
  const { data: form } = await admin
    .from("forms")
    .insert({ workspace_id: workspaceId, title: "Resume", slug, created_by: userId })
    .select("id")
    .single();
  formId = form!.id;
  await admin
    .from("form_versions")
    .insert({ form_id: formId, status: "draft", version_number: 1, schema });
  await publish();
});

afterAll(async () => {
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("resume links", () => {
  it("are refused while the creator hasn't turned them on", async () => {
    const responseId = await unfinished();
    await expect(createResumeLink(admin, responseId)).rejects.toBeInstanceOf(
      ResumeUnavailableError,
    );
  });

  it("open the same response with its answers, position and back history", async () => {
    await admin.from("forms").update({ resume_links_enabled: true }).eq("id", formId);
    const responseId = await unfinished();
    const { path } = await createResumeLink(admin, responseId);
    expect(path).toMatch(new RegExp(`^/f/${slug}\\?resume=[A-Za-z0-9_-]{43}$`));

    // Only the hash is stored.
    const { data: rows } = await admin
      .from("resume_tokens")
      .select("token_hash")
      .eq("response_id", responseId);
    expect(rows?.[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows?.[0].token_hash).not.toContain(tokenOf(path));

    const result = await resolveResumeToken(admin, tokenOf(path), await publicForm());
    expect(result).toEqual({
      ok: true,
      response: {
        responseId,
        formVersionId: (await publicForm()).formVersionId,
        revision: 1,
        answers: { q1: "Ada" },
        lastQuestionId: "q2",
        history: ["q1"],
        hidden: {},
      },
    });
  });

  it("stop working once the response is submitted, without a duplicate", async () => {
    const responseId = await unfinished();
    const token = tokenOf((await createResumeLink(admin, responseId)).path);
    const result = await completeResponse(
      admin,
      responseId,
      2,
      "q3",
      { q1: "Ada", q2: "Research" },
      crypto.randomUUID(),
    );
    expect(result.ok).toBe(true);
    expect(await resolveResumeToken(admin, token, await publicForm())).toEqual({
      ok: false,
      reason: "submitted",
    });
    const { data } = await admin
      .from("resume_tokens")
      .select("revoked_at")
      .eq("response_id", responseId)
      .single();
    expect(data?.revoked_at).not.toBeNull();
    await expect(createResumeLink(admin, responseId)).rejects.toThrow(
      "already submitted",
    );
  });

  it("expire", async () => {
    const responseId = await unfinished();
    const token = tokenOf((await createResumeLink(admin, responseId)).path);
    const later = new Date(Date.now() + 31 * 86_400_000);
    expect(await resolveResumeToken(admin, token, await publicForm(), later)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("don't carry a response onto a republished form", async () => {
    const responseId = await unfinished();
    const token = tokenOf((await createResumeLink(admin, responseId)).path);
    await publish();
    expect(await resolveResumeToken(admin, token, await publicForm())).toEqual({
      ok: false,
      reason: "changed",
    });
  });

  it("stop working when the creator turns them off", async () => {
    const responseId = await unfinished();
    const token = tokenOf((await createResumeLink(admin, responseId)).path);
    await admin.from("forms").update({ resume_links_enabled: false }).eq("id", formId);
    expect(await resolveResumeToken(admin, token, await publicForm())).toEqual({
      ok: false,
      reason: "disabled",
    });
    await admin.from("forms").update({ resume_links_enabled: true }).eq("id", formId);
  });

  it("only open on their own form, and reject made-up tokens", async () => {
    const responseId = await unfinished();
    const token = tokenOf((await createResumeLink(admin, responseId)).path);
    const other = { ...(await publicForm()), formId: crypto.randomUUID() };
    expect(await resolveResumeToken(admin, token, other)).toEqual({
      ok: false,
      reason: "invalid",
    });
    const form = await publicForm();
    expect(await resolveResumeToken(admin, "A".repeat(43), form)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await resolveResumeToken(admin, "'; drop table x; --", form)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
