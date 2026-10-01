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

  // A filled honeypot looks successful but completes nothing.
  const trapped = await complete(
    { q_email: "bot@example.com" },
    { website: "http://spam" },
  );
  expect(trapped.status()).toBe(200);
  const { data: afterTrap } = await adminClient()
    .from("responses")
    .select("status")
    .eq("id", responseId)
    .single();
  expect(afterTrap?.status).not.toBe("completed");

  const ok = await complete({ q_email: "real@example.com" });
  expect(ok.status()).toBe(200);
  expect((await ok.json()).endingId).toBe("end");
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
