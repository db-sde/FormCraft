import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  completeResponse,
  FormClosedError,
  saveResponseAnswers,
  startResponse,
} from "@/domains/responses";
import { checkAvailability, countAcceptedResponses } from "@/domains/forms/availability";
import {
  createUnlockToken,
  getPasswordHash,
  isUnlocked,
  setFormPassword,
  verifyPassword,
} from "@/domains/forms/access";
import { markCaptchaVerified, submissionGuards } from "@/domains/responses/guards";

/**
 * Phase 0 guardrails against the real database (master spec F-46, F-47,
 * F-48): the close date and response cap are enforced inside
 * complete_response_atomic, so they hold for requests that race, and for
 * a page that was loaded before the form closed.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin: SupabaseClient<Database> = createClient<Database>(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const runId = crypto.randomUUID().slice(0, 8);
const schema = {
  schemaVersion: 1,
  meta: { title: "Availability" },
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
  ],
  logic: [],
} as unknown as Json;

let userId: string;
let password: string;
let email: string;
let workspaceId: string;
let formId: string;

beforeAll(async () => {
  email = `availability-${runId}@example.com`;
  password = crypto.randomUUID();
  const { data: user, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  userId = user.user.id;
  const { data: workspace } = await admin
    .from("workspaces")
    .insert({ name: "Availability", slug: `avail-${runId}`, owner_id: userId })
    .select("id")
    .single();
  workspaceId = workspace!.id;
  await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: userId, role: "owner" });
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Availability",
      slug: `avail-form-${runId}`,
      created_by: userId,
    })
    .select("id")
    .single();
  formId = form!.id;
  await admin
    .from("form_versions")
    .insert({ form_id: formId, status: "draft", version_number: 1, schema });
  const { error: publishError } = await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: schema,
  });
  if (publishError) throw publishError;
}, 60_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", workspaceId);
  await admin.auth.admin.deleteUser(userId);
});

/** Each test starts from an open form with no responses. */
beforeEach(async () => {
  await admin.from("responses").delete().eq("form_id", formId);
  await admin
    .from("forms")
    .update({
      closes_at: null,
      response_cap: null,
      closed_message: null,
      full_message: null,
    })
    .eq("id", formId);
});

async function setForm(update: Database["public"]["Tables"]["forms"]["Update"]) {
  const { error } = await admin.from("forms").update(update).eq("id", formId);
  if (error) throw error;
}

async function statusOf(responseId: string) {
  const { data } = await admin
    .from("responses")
    .select("status")
    .eq("id", responseId)
    .single();
  return data?.status;
}

const submit = (responseId: string, name = "Ada") =>
  completeResponse(admin, responseId, 1, "q1", { q1: name }, crypto.randomUUID());

describe("close date (F-46)", () => {
  it("refuses new starts after the deadline, with the creator's message", async () => {
    await setForm({
      closes_at: new Date(Date.now() - 60_000).toISOString(),
      closed_message: "Registration closed on Friday.",
    });
    await expect(startResponse(admin, formId)).rejects.toMatchObject({
      reason: "closed",
      respondentMessage: "Registration closed on Friday.",
    });
  });

  it("refuses a submit from a page opened before the form closed, and writes nothing", async () => {
    const { responseId } = await startResponse(admin, formId);
    await setForm({ closes_at: new Date(Date.now() - 1000).toISOString() });

    expect(await submit(responseId)).toMatchObject({
      ok: false,
      code: "form_closed",
      reason: "closed",
    });
    expect(await statusOf(responseId)).not.toBe("completed");
    const { count } = await admin
      .from("answers")
      .select("id", { count: "exact", head: true })
      .eq("response_id", responseId);
    expect(count).toBe(0);
  });

  it("enforces the deadline in the database itself, not only in the app", async () => {
    const { responseId } = await startResponse(admin, formId);
    await setForm({ closes_at: new Date(Date.now() - 1000).toISOString() });
    const { data } = await admin.rpc("complete_response_atomic", {
      p_response_id: responseId,
      p_revision: 1,
      p_last_question_id: "q1",
      p_answers: { q1: "Ada" },
      p_ending_id: "end",
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(data?.[0]?.outcome).toBe("closed");
    expect(await statusOf(responseId)).not.toBe("completed");
  });

  it("keeps no new autosaves once closed", async () => {
    const { responseId } = await startResponse(admin, formId);
    await setForm({ closes_at: new Date(Date.now() - 1000).toISOString() });
    await expect(
      saveResponseAnswers(admin, responseId, 1, "q1", { q1: "late" }),
    ).rejects.toBeInstanceOf(FormClosedError);
  });

  it("still answers a retried submit that went through before closing", async () => {
    const { responseId } = await startResponse(admin, formId);
    const key = crypto.randomUUID();
    expect(
      (await completeResponse(admin, responseId, 1, "q1", { q1: "A" }, key)).ok,
    ).toBe(true);
    await setForm({ closes_at: new Date(Date.now() - 1000).toISOString() });
    expect(
      await completeResponse(admin, responseId, 1, "q1", { q1: "A" }, key),
    ).toMatchObject({ ok: true, alreadyCompleted: true });
  });

  it("is open again once the creator moves the date later", async () => {
    await setForm({ closes_at: new Date(Date.now() - 1000).toISOString() });
    expect((await checkAvailability(admin, formId)).open).toBe(false);
    await setForm({ closes_at: new Date(Date.now() + 3_600_000).toISOString() });
    expect((await checkAvailability(admin, formId)).open).toBe(true);
    const { responseId } = await startResponse(admin, formId);
    expect((await submit(responseId)).ok).toBe(true);
  });
});

describe("response cap (F-47)", () => {
  it("lets exactly one of two simultaneous submits take the last place", async () => {
    await setForm({ response_cap: 1, full_message: "All seats taken." });
    const a = await startResponse(admin, formId);
    const b = await startResponse(admin, formId);

    const results = await Promise.all([
      submit(a.responseId, "A"),
      submit(b.responseId, "B"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, code: "form_closed", reason: "full", message: "All seats taken." },
    ]);
    expect(await countAcceptedResponses(admin, formId)).toBe(1);
  });

  it("never goes past the cap under 12 racing submits", async () => {
    await setForm({ response_cap: 3 });
    const started = await Promise.all(
      Array.from({ length: 12 }, () => startResponse(admin, formId)),
    );
    const results = await Promise.all(started.map((s) => submit(s.responseId)));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(await countAcceptedResponses(admin, formId)).toBe(3);
  });

  it("counts only completed responses: unfinished and spam ones never use a place", async () => {
    await setForm({ response_cap: 1 });
    // Started and abandoned.
    await startResponse(admin, formId);
    // Flagged as spam by the honeypot.
    const spam = await startResponse(admin, formId);
    expect(
      (
        await completeResponse(
          admin,
          spam.responseId,
          1,
          "q1",
          { q1: "bot" },
          crypto.randomUUID(),
          {
            spamSuspected: true,
          },
        )
      ).ok,
    ).toBe(true);
    expect(await countAcceptedResponses(admin, formId)).toBe(0);

    const real = await startResponse(admin, formId);
    expect((await submit(real.responseId)).ok).toBe(true);
    await expect(startResponse(admin, formId)).rejects.toMatchObject({ reason: "full" });
  });

  it("takes responses again when the creator raises the cap", async () => {
    await setForm({ response_cap: 1 });
    const first = await startResponse(admin, formId);
    expect((await submit(first.responseId)).ok).toBe(true);
    expect((await checkAvailability(admin, formId)).open).toBe(false);
    await setForm({ response_cap: 2 });
    const second = await startResponse(admin, formId);
    expect((await submit(second.responseId)).ok).toBe(true);
  });
});

describe("form password (F-48)", () => {
  it("keeps only a hash, unlocks with a signed cookie, and locks out old cookies on change", async () => {
    await setFormPassword(admin, formId, "letmein");
    const hash = await getPasswordHash(admin, formId);
    expect(hash).not.toBeNull();
    expect(hash).not.toContain("letmein");
    expect(await verifyPassword("letmein", hash!)).toBe(true);

    expect(await isUnlocked(admin, formId, undefined)).toBe(false);
    const cookie = createUnlockToken(formId, hash!);
    expect(await isUnlocked(admin, formId, cookie)).toBe(true);

    await setFormPassword(admin, formId, "new-password");
    expect(await isUnlocked(admin, formId, cookie)).toBe(false);

    await setFormPassword(admin, formId, null);
    expect(await getPasswordHash(admin, formId)).toBeNull();
    expect(await isUnlocked(admin, formId, undefined)).toBe(true);
  });

  it("hides the hash from workspace members and anonymous visitors", async () => {
    await setFormPassword(admin, formId, "letmein");

    const member = createClient<Database>(
      url,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false },
      },
    );
    const { error: signInError } = await member.auth.signInWithPassword({
      email,
      password,
    });
    expect(signInError).toBeNull();
    const asMember = await member.from("form_access_secrets").select("password_hash");
    expect(asMember.data ?? []).toEqual([]);
    const write = await member
      .from("form_access_secrets")
      .update({ password_hash: "x" })
      .eq("form_id", formId);
    expect(write.error).not.toBeNull();

    const anon = createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const asAnon = await anon.from("form_access_secrets").select("password_hash");
    expect(asAnon.data ?? []).toEqual([]);

    await setFormPassword(admin, formId, null);
  });
});

describe("CAPTCHA, once per response (F-26)", () => {
  it("asks until the response passes, then never again for it", async () => {
    await setForm({ captcha_required: true });
    try {
      const { responseId } = await startResponse(admin, formId);
      expect(await submissionGuards(admin, responseId)).toMatchObject({
        formId,
        completed: false,
        needsCaptcha: true,
      });
      await markCaptchaVerified(admin, responseId);
      expect((await submissionGuards(admin, responseId))?.needsCaptcha).toBe(false);
      // Another response on the same form still has to pass it.
      const other = await startResponse(admin, formId);
      expect((await submissionGuards(admin, other.responseId))?.needsCaptcha).toBe(true);
    } finally {
      await setForm({ captcha_required: false });
    }
  });

  it("isn't asked on a form that doesn't require it", async () => {
    const { responseId } = await startResponse(admin, formId);
    expect((await submissionGuards(admin, responseId))?.needsCaptcha).toBe(false);
  });
});
