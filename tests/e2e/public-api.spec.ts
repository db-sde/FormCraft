import { test, expect } from "@playwright/test";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import { createApiKey } from "@/domains/api/keys";
import {
  adminClient,
  createConfirmedUser,
  createPublishedForm,
  deleteUser,
} from "./helpers";

/**
 * The /api/v1 surface Zapier and Make use (P2.13), over HTTP: a key
 * authenticates its own workspace only, lists live forms, returns sample
 * responses, and subscribes / unsubscribes a REST hook — which is an
 * ordinary signed webhook endpoint underneath.
 */
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  meta: { title: "API form" },
  theme: {
    primaryColor: "#1f1f1f",
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
  ],
  logic: [],
};

test("Zapier/Make: authenticate, list forms, sample, subscribe and unsubscribe", async ({
  request,
}) => {
  const owner = await createConfirmedUser("e2e-api");
  const other = await createConfirmedUser("e2e-api-other");
  try {
    const { formId } = await createPublishedForm(owner, schema);
    const { formId: foreignFormId } = await createPublishedForm(other, schema);
    const admin = adminClient();
    const { data: ws } = await admin
      .from("forms")
      .select("workspace_id")
      .eq("id", formId)
      .single();
    await admin
      .from("workspaces")
      .update({ plan_id: "business" })
      .eq("id", ws!.workspace_id);
    const { key } = await createApiKey(admin, {
      workspaceId: ws!.workspace_id,
      name: "Zapier",
      createdBy: owner.userId,
    });
    const auth = { Authorization: `Bearer ${key}` };

    expect((await request.get("/api/v1/me")).status()).toBe(401);
    const me = await request.get("/api/v1/me", { headers: auth });
    expect(me.status()).toBe(200);
    expect((await me.json()).workspace.id).toBe(ws!.workspace_id);

    const forms = await (await request.get("/api/v1/forms", { headers: auth })).json();
    expect(forms.forms).toEqual([{ id: formId, title: "API form" }]);

    // One completed response, then the sample has it in the delivery shape.
    const start = await request.post("/api/responses/start", { data: { formId } });
    const { responseId } = await start.json();
    await request.post(`/api/responses/${responseId}/complete`, {
      data: {
        clientRevision: 1,
        lastQuestionId: "q1",
        answers: { q1: "Ada" },
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const sample = await (
      await request.get(`/api/v1/forms/${formId}/responses`, { headers: auth })
    ).json();
    expect(sample[0]).toMatchObject({
      eventType: "response.completed",
      formId,
      responseId,
      answers: { q1: "Ada" },
    });
    expect(
      (
        await request.get(`/api/v1/forms/${foreignFormId}/responses`, { headers: auth })
      ).status(),
    ).toBe(404);

    const created = await request.post("/api/v1/hooks", {
      headers: auth,
      data: { formId, url: "https://hooks.zapier.example/catch/1", source: "zapier" },
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    const { data: hook } = await admin
      .from("webhook_endpoints")
      .select("kind, form_id")
      .eq("id", id)
      .single();
    expect(hook).toEqual({ kind: "zapier", form_id: formId });

    expect(
      (
        await request.post("/api/v1/hooks", {
          headers: auth,
          data: { formId: foreignFormId, url: "https://hooks.zapier.example/catch/2" },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.post("/api/v1/hooks", {
          headers: auth,
          data: { formId, url: "http://127.0.0.1/steal" },
        })
      ).status(),
    ).toBe(400);

    expect(
      (await request.delete(`/api/v1/hooks/${id}`, { headers: auth })).status(),
    ).toBe(204);
    const { data: gone } = await admin
      .from("webhook_endpoints")
      .select("id")
      .eq("id", id);
    expect(gone).toEqual([]);
  } finally {
    await deleteUser(other.userId);
    await deleteUser(owner.userId);
  }
});
