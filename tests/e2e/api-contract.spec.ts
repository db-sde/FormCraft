import { test, expect, type APIRequestContext } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
} from "./helpers";

/**
 * The public HTTP contract the respondent runtime (and anyone scripting
 * against it) depends on: status codes and error shapes for good and bad
 * input, the spam trap, and cron authentication. Pinned so internal
 * refactors can't silently change what clients see.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "API contract" },
  theme: {
    primaryColor: "#4f46e5",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    buttonStyle: "rounded",
  },
  endings: [{ id: "end", title: "Thanks!", isDefault: true }],
  questions: [
    {
      id: "q_email",
      type: "email",
      order: 0,
      label: "Email",
      required: true,
      settings: {},
    },
    {
      id: "q_file",
      type: "file_upload",
      order: 1,
      label: "Photo",
      required: false,
      settings: { acceptedMimeTypes: ["image/*"], maxSizeMb: 1 },
    },
  ],
  logic: [],
};

let user: Awaited<ReturnType<typeof createConfirmedUser>>;
let formId: string;

test.beforeAll(async () => {
  user = await createConfirmedUser("e2e-api");
  ({ formId } = await createPublishedForm(user, schema));
});
test.afterAll(async () => {
  await deleteUser(user.userId);
});

async function start(request: APIRequestContext) {
  const res = await request.post("/api/responses/start", { data: { formId } });
  expect(res.status()).toBe(200);
  return (await res.json()) as { responseId: string; formVersionId: string };
}

test("start: validates input and only starts live forms", async ({ request }) => {
  expect((await request.post("/api/responses/start", { data: {} })).status()).toBe(400);
  const unknown = await request.post("/api/responses/start", {
    data: { formId: crypto.randomUUID() },
  });
  expect(unknown.status()).toBe(404);
  expect((await unknown.json()).error.code).toBe("form_not_available");

  const { responseId, formVersionId } = await start(request);
  expect(responseId).toMatch(/^[0-9a-f-]{36}$/);
  expect(formVersionId).toMatch(/^[0-9a-f-]{36}$/);
});

test("answers: rejects bad ids and stale revisions with the server's revision", async ({
  request,
}) => {
  expect(
    (await request.patch("/api/responses/not-a-uuid/answers", { data: {} })).status(),
  ).toBe(400);
  const missing = await request.patch(`/api/responses/${crypto.randomUUID()}/answers`, {
    data: { clientRevision: 1, lastQuestionId: "q_email", answers: {} },
  });
  expect(missing.status()).toBe(404);

  const { responseId } = await start(request);
  const save = (clientRevision: number) =>
    request.patch(`/api/responses/${responseId}/answers`, {
      data: { clientRevision, lastQuestionId: "q_email", answers: { q_email: "a@b.co" } },
    });
  expect((await save(5)).status()).toBe(200);
  const stale = await save(3);
  expect(stale.status()).toBe(409);
  expect((await stale.json()).currentRevision).toBe(5);
});

test("complete: per-question errors, idempotent success, and the spam trap", async ({
  request,
}) => {
  const { responseId } = await start(request);
  const complete = (answers: Record<string, unknown>, extra: object = {}) =>
    request.post(`/api/responses/${responseId}/complete`, {
      data: {
        clientRevision: 1,
        lastQuestionId: "q_email",
        answers,
        idempotencyKey: crypto.randomUUID(),
        ...extra,
      },
    });

  const invalid = await complete({ q_email: "not-an-email" });
  expect(invalid.status()).toBe(400);
  const body = await invalid.json();
  expect(body.error.errors[0]).toMatchObject({ questionId: "q_email" });

  // A filled spam trap never loses the submission: it completes, but
  // flagged — autofill can fill hidden fields in a real person's browser.
  const trapped = await complete({ q_email: "bot@example.com" }, { trap: "http://spam" });
  expect(trapped.status()).toBe(200);
  const { data: afterTrap } = await adminClient()
    .from("responses")
    .select("status, spam_suspected")
    .eq("id", responseId)
    .single();
  expect(afterTrap).toEqual({ status: "completed", spam_suspected: true });

  // Retrying a completed response is idempotent, not an error.
  const again = await complete({ q_email: "real@example.com" });
  expect(again.status()).toBe(200);
  expect((await again.json()).endingId).toBe("end");
});

test("complete: a normal submission is stored on the path taken and not flagged", async ({
  request,
}) => {
  const { responseId } = await start(request);
  const ok = await request.post(`/api/responses/${responseId}/complete`, {
    data: {
      clientRevision: 1,
      lastQuestionId: "q_email",
      answers: { q_email: "real@example.com", not_a_question: "ignored" },
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(ok.status()).toBe(200);
  const admin = adminClient();
  const { data: row } = await admin
    .from("responses")
    .select("status, spam_suspected, ending_id")
    .eq("id", responseId)
    .single();
  expect(row).toEqual({ status: "completed", spam_suspected: false, ending_id: "end" });
  const { data: answers } = await admin
    .from("answers")
    .select("question_id")
    .eq("response_id", responseId);
  expect(answers).toEqual([{ question_id: "q_email" }]);
});

test("uploads: size checked before the body is read, and never after submit", async ({
  request,
}) => {
  const png = (size: number) => {
    const bytes = Buffer.alloc(size);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
    return bytes;
  };
  const upload = (responseId: string, size: number) =>
    request.post(`/api/responses/${responseId}/uploads/q_file`, {
      multipart: { file: { name: "a.png", mimeType: "image/png", buffer: png(size) } },
    });

  const { responseId } = await start(request);
  const tooBig = await upload(responseId, 2 * 1024 * 1024);
  expect(tooBig.status()).toBe(413);
  expect((await tooBig.json()).error.code).toBe("too_large");

  const fine = await upload(responseId, 1024);
  expect(fine.status()).toBe(200);
  expect((await fine.json()).uploadId).toMatch(/^[0-9a-f-]{36}$/);

  const submit = await request.post(`/api/responses/${responseId}/complete`, {
    data: {
      clientRevision: 1,
      lastQuestionId: "q_file",
      answers: { q_email: "files@example.com" },
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(submit.status()).toBe(200);
  const late = await upload(responseId, 1024);
  expect(late.status()).toBe(409);
  expect((await late.json()).error.code).toBe("already_submitted");
});

test("uploads and events: validate input", async ({ request }) => {
  const { responseId } = await start(request);
  const noFile = await request.post(`/api/responses/${responseId}/uploads/q_email`, {
    multipart: { other: "x" },
  });
  expect(noFile.status()).toBe(400);

  expect((await request.post("/api/responses/events", { data: {} })).status()).toBe(400);
  const event = await request.post("/api/responses/events", {
    data: { formId, type: "question_viewed", questionId: "q_email" },
  });
  expect(event.status()).toBe(204);
});

test("cron routes require the shared secret", async ({ request }) => {
  const secret = process.env.CRON_SECRET;
  test.skip(!secret, "CRON_SECRET not set");
  for (const path of [
    "/api/cron/retention",
    "/api/cron/webhooks/dispatch",
    "/api/cron/sheets/dispatch",
  ]) {
    expect((await request.get(path)).status(), path).toBe(401);
    const authed = await request.get(path, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(authed.status(), path).toBe(200);
  }
});
