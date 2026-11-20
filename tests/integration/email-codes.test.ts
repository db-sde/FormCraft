import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { parseFormSchema } from "@/domains/forms/schema";
import type { OutgoingEmail } from "@/domains/notifications/mailer";
import {
  checkEmailCode,
  MAX_ATTEMPTS,
  sendEmailCode,
  verifiedEmails,
  withoutEmailVerification,
} from "@/domains/verification/email-code";

/** Email verification codes (roadmap #8, migration 69) against the real
 * database, with a stand-in mailer that keeps what it was given. */
const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const SECRET = "test-app-secret-for-email-codes-0123456789";
const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
const rawSchema = {
  schemaVersion: 1,
  meta: { title: "Sign up" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "email",
      type: "email",
      order: 0,
      label: "Email",
      required: true,
      settings: { verify: true },
    },
  ],
  logic: [],
};
const schema = parseFormSchema(rawSchema);
const question = schema.questions[0] as Extract<
  (typeof schema.questions)[number],
  { type: "email" }
>;

let userId: string;
let workspaceId: string;
let formId: string;
let versionId: string;
const outbox: OutgoingEmail[] = [];
const send = async (email: OutgoingEmail) => {
  outbox.push(email);
  return { ok: true as const };
};
const lastCode = () => /^(\d{6}) /.exec(outbox.at(-1)!.subject)![1];

async function newResponse() {
  const { data } = await admin
    .from("responses")
    .insert({ form_id: formId, form_version_id: versionId, status: "partial" })
    .select("id")
    .single();
  return data!.id;
}

beforeAll(async () => {
  const { data: user } = await admin.auth.admin.createUser({
    email: `codes-${runId}@example.com`,
    password: `Pw-${crypto.randomUUID()}`,
    email_confirm: true,
  });
  userId = user.user!.id;
  const { data: ws } = await admin
    .from("workspaces")
    .insert({ name: "Codes", slug: `codes-${runId}`, owner_id: userId })
    .select("id")
    .single();
  workspaceId = ws!.id;
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Sign up",
      slug: `codes-${runId}`,
      created_by: userId,
    })
    .select("id")
    .single();
  formId = form!.id;
  await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: rawSchema as unknown as Json,
  });
  versionId = (
    await admin
      .from("form_versions")
      .select("id")
      .eq("form_id", formId)
      .eq("status", "published")
      .single()
  ).data!.id;
}, 60_000);

afterAll(async () => {
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("email verification codes (#8)", () => {
  it("sends a code to the address and verifies it once entered", async () => {
    const responseId = await newResponse();
    const t0 = new Date("2026-11-20T10:00:00Z");
    expect(
      await sendEmailCode(admin, {
        responseId,
        question,
        email: " Ada@Example.com ",
        formTitle: "Sign up",
        send,
        now: t0,
        secret: SECRET,
      }),
    ).toEqual({ ok: true });
    expect(outbox.at(-1)!.to).toEqual(["ada@example.com"]);
    const code = lastCode();
    const { data: stored } = await admin
      .from("email_verifications")
      .select("code_hash")
      .eq("response_id", responseId)
      .single();
    expect(stored!.code_hash).not.toContain(code);

    const wrong = code === "000000" ? "111111" : "000000";
    expect(
      await checkEmailCode(admin, {
        responseId,
        questionId: "email",
        code: wrong,
        now: t0,
        secret: SECRET,
      }),
    ).toEqual({
      ok: false,
      message: `That code isn't right. ${MAX_ATTEMPTS - 1} tries left.`,
    });
    expect(
      await checkEmailCode(admin, {
        responseId,
        questionId: "email",
        code: ` ${code.slice(0, 3)} ${code.slice(3)} `,
        now: t0,
        secret: SECRET,
      }),
    ).toEqual({ ok: true, email: "ada@example.com" });
    expect(await verifiedEmails(admin, responseId)).toEqual(
      new Map([["email", "ada@example.com"]]),
    );
  });

  it("expires codes, limits tries, spaces out and caps resends", async () => {
    const responseId = await newResponse();
    const t0 = new Date("2026-11-20T11:00:00Z");
    const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);
    const ask = (seconds: number, email = "bo@example.com") =>
      sendEmailCode(admin, {
        responseId,
        question,
        email,
        formTitle: "Sign up",
        send,
        now: at(seconds),
        secret: SECRET,
      });
    const check = (code: string, seconds: number) =>
      checkEmailCode(admin, {
        responseId,
        questionId: "email",
        code,
        now: at(seconds),
        secret: SECRET,
      });

    expect(await ask(0)).toEqual({ ok: true });
    expect(await ask(10)).toMatchObject({
      ok: false,
      code: "wait",
      retryAfterSeconds: 20,
    });
    // Expired after ten minutes.
    expect(await check(lastCode(), 601)).toEqual({
      ok: false,
      message: "That code has expired. Ask for a new one.",
    });

    expect(await ask(700)).toEqual({ ok: true });
    const good = lastCode();
    const wrong = good === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) await check(wrong, 701);
    // The right code is refused once the tries are used up.
    expect(await check(good, 702)).toEqual({
      ok: false,
      message: "Too many wrong codes. Ask for a new one.",
    });

    expect(await ask(800)).toEqual({ ok: true }); // 3rd
    expect(await ask(900)).toEqual({ ok: true }); // 4th
    expect(await ask(1000, "other@example.com")).toEqual({ ok: true }); // 5th
    expect(await ask(1100)).toMatchObject({ ok: false, code: "too_many" });
    expect(await verifiedEmails(admin, responseId)).toEqual(new Map());
  });

  it("refuses bad addresses, and does nothing without a mailer", async () => {
    const responseId = await newResponse();
    expect(
      await sendEmailCode(admin, {
        responseId,
        question,
        email: "a@b.com, c@d.com",
        formTitle: "x",
        send,
        secret: SECRET,
      }),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(
      await sendEmailCode(admin, {
        responseId,
        question,
        email: "a@example.com",
        formTitle: "x",
        send: null,
        secret: SECRET,
      }),
    ).toMatchObject({ ok: false, code: "not_available" });
  });

  it("drops the requirement from a form when codes can't be sent", () => {
    const plain = withoutEmailVerification(schema);
    expect(plain.questions[0].settings).not.toHaveProperty("verify", true);
    expect(schema.questions[0].settings).toHaveProperty("verify", true);
  });
});
