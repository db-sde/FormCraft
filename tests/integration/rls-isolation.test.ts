import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listWorkspacesForCurrentUser } from "@/domains/workspaces";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";

/**
 * Tenant isolation against the real database, through the same Data API
 * and RPCs a hostile client would use — never through the app's own
 * routes, which add their own checks and would hide a missing policy.
 *
 * A "victim" tenant owns a draft form, a published form, a response with
 * an answer and an upload, a webhook, a Sheets connection, a
 * notification setting and an analytics event. An "intruder" (another
 * signed-in user) and an anonymous visitor try to read, change, or take
 * over all of it.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false },
});
const plain = () =>
  createClient<Database>(url, anonKey, { auth: { persistSession: false } });

const runId = crypto.randomUUID().slice(0, 8);
const password = `Pw-${crypto.randomUUID()}`;

const schema = {
  schemaVersion: 1,
  meta: { title: "Victim form" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    {
      id: "q1",
      type: "short_text",
      order: 0,
      label: "Name",
      required: false,
      settings: {},
    },
  ],
  logic: [],
} as unknown as Json;

type Tenant = {
  userId: string;
  client: SupabaseClient<Database>;
  workspaceId: string;
};

async function makeTenant(label: string): Promise<Tenant> {
  const email = `rls-${label}-${runId}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const client = plain();
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;

  // The supported creation path: the RPC, as the user.
  const { data: workspace, error: wsError } = await client.rpc(
    "create_workspace_with_owner",
    {
      workspace_name: `${label} workspace`,
      workspace_slug: `rls-${label}-${runId}`,
    },
  );
  if (wsError) throw wsError;
  return { userId: data.user.id, client, workspaceId: workspace.id };
}

let victim: Tenant;
let intruder: Tenant;
let draftFormId: string;
let publishedFormId: string;
let responseId: string;
let uploadPath: string;
let endpointId: string;

beforeAll(async () => {
  victim = await makeTenant("victim");
  intruder = await makeTenant("intruder");

  const makeForm = async (slug: string, publish: boolean) => {
    const { data: form, error } = await admin
      .from("forms")
      .insert({
        workspace_id: victim.workspaceId,
        title: `Victim ${slug}`,
        slug: `rls-${slug}-${runId}`,
        created_by: victim.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    await admin
      .from("form_versions")
      .insert({ form_id: form.id, status: "draft", version_number: 1, schema });
    if (publish) {
      const { error: publishError } = await admin.rpc("publish_form_version", {
        target_form_id: form.id,
        compiled_schema: schema,
      });
      if (publishError) throw publishError;
    }
    return form.id;
  };
  draftFormId = await makeForm("draft", false);
  publishedFormId = await makeForm("published", true);

  const { data: version } = await admin
    .from("form_versions")
    .select("id")
    .eq("form_id", publishedFormId)
    .eq("status", "published")
    .single();
  const { data: response } = await admin
    .from("responses")
    .insert({
      form_id: publishedFormId,
      form_version_id: version!.id,
      status: "completed",
    })
    .select("id")
    .single();
  responseId = response!.id;
  await admin
    .from("answers")
    .insert({ response_id: responseId, question_id: "q1", value: "secret answer" });
  uploadPath = `${victim.workspaceId}/${responseId}/secret.txt`;
  await admin.storage
    .from("response-uploads")
    .upload(uploadPath, new Blob(["secret file"]), { contentType: "text/plain" });
  await admin.from("uploads").insert({
    response_id: responseId,
    question_id: "q1",
    storage_path: uploadPath,
    original_filename: "secret.txt",
    mime_type: "text/plain",
    size_bytes: 11,
  });
  const { data: endpoint } = await admin
    .from("webhook_endpoints")
    .insert({
      form_id: publishedFormId,
      url: "https://example.com/hook",
      signing_secret: "whsec_x",
    })
    .select("id")
    .single();
  endpointId = endpoint!.id;
  await admin.from("webhook_deliveries").insert({
    endpoint_id: endpointId,
    response_id: responseId,
    event_type: "response.completed",
    payload: {} as Json,
  });
  await admin.from("sheets_connections").insert({
    workspace_id: victim.workspaceId,
    form_id: publishedFormId,
    encrypted_tokens: { c: "x" } as Json,
  });
  await admin
    .from("notification_settings")
    .insert({ form_id: publishedFormId, enabled: false });
  await admin
    .from("analytics_events")
    .insert({ form_id: publishedFormId, event_type: "form_viewed" });
}, 60_000);

afterAll(async () => {
  for (const tenant of [victim, intruder]) {
    if (!tenant) continue;
    await admin.storage.from("response-uploads").remove([uploadPath]);
    await admin.from("workspaces").delete().eq("owner_id", tenant.userId);
    await admin.auth.admin.deleteUser(tenant.userId);
  }
}, 60_000);

/** Tables an outsider must see no rows of, with a filter that would match
 * the victim's data if policies let it through. */
const READABLE_ONLY_BY_MEMBERS = [
  ["forms", (t: Tenant) => t.client.from("forms").select("id").eq("id", draftFormId)],
  [
    "published forms",
    (t: Tenant) => t.client.from("forms").select("id").eq("id", publishedFormId),
  ],
  [
    "form_versions",
    (t: Tenant) =>
      t.client.from("form_versions").select("id").eq("form_id", publishedFormId),
  ],
  [
    "responses",
    (t: Tenant) => t.client.from("responses").select("id").eq("id", responseId),
  ],
  [
    "answers",
    (t: Tenant) => t.client.from("answers").select("id").eq("response_id", responseId),
  ],
  [
    "uploads",
    (t: Tenant) => t.client.from("uploads").select("id").eq("response_id", responseId),
  ],
  [
    "webhook_endpoints",
    (t: Tenant) =>
      t.client.from("webhook_endpoints").select("id").eq("form_id", publishedFormId),
  ],
  [
    "webhook_deliveries",
    (t: Tenant) =>
      t.client.from("webhook_deliveries").select("id").eq("endpoint_id", endpointId),
  ],
  [
    "sheets_connections",
    (t: Tenant) =>
      t.client.from("sheets_connections").select("id").eq("form_id", publishedFormId),
  ],
  [
    "notification_settings",
    (t: Tenant) =>
      t.client.from("notification_settings").select("id").eq("form_id", publishedFormId),
  ],
  [
    "analytics_events",
    (t: Tenant) =>
      t.client.from("analytics_events").select("id").eq("form_id", publishedFormId),
  ],
  [
    "workspaces",
    (t: Tenant) => t.client.from("workspaces").select("id").eq("id", victim.workspaceId),
  ],
  [
    "workspace_members",
    (t: Tenant) =>
      t.client
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", victim.workspaceId),
  ],
  [
    "profiles",
    (t: Tenant) => t.client.from("profiles").select("id").eq("id", victim.userId),
  ],
] as const;

describe("another signed-in user (intruder)", () => {
  for (const [name, query] of READABLE_ONLY_BY_MEMBERS) {
    it(`cannot read the victim's ${name}`, async () => {
      const { data, error } = await query(intruder);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  }

  it("cannot make themselves a member or owner of the victim's workspace", async () => {
    try {
      for (const role of ["owner", "editor"] as const) {
        // Remove a previous iteration's membership so each role is tried
        // against a clean slate (the primary key is workspace + user).
        await admin
          .from("workspace_members")
          .delete()
          .eq("workspace_id", victim.workspaceId)
          .eq("user_id", intruder.userId);
        const { error } = await intruder.client
          .from("workspace_members")
          .insert({ workspace_id: victim.workspaceId, user_id: intruder.userId, role });
        expect(error, `role ${role}`).not.toBeNull();
      }
      const { data } = await admin
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", victim.workspaceId)
        .eq("user_id", intruder.userId);
      expect(data).toEqual([]);
      // …and so still sees nothing.
      const forms = await intruder.client
        .from("forms")
        .select("id")
        .eq("id", draftFormId);
      expect(forms.data).toEqual([]);
    } finally {
      // If the takeover worked, don't let it contaminate other tests.
      await admin
        .from("workspace_members")
        .delete()
        .eq("workspace_id", victim.workspaceId)
        .eq("user_id", intruder.userId);
    }
  });

  it("cannot create or change anything inside the victim's workspace", async () => {
    const insertForm = await intruder.client.from("forms").insert({
      workspace_id: victim.workspaceId,
      title: "planted",
      slug: `planted-${runId}`,
      created_by: intruder.userId,
    });
    expect(insertForm.error).not.toBeNull();

    const insertVersion = await intruder.client
      .from("form_versions")
      .insert({ form_id: draftFormId, status: "draft", version_number: 9, schema });
    expect(insertVersion.error).not.toBeNull();

    await intruder.client
      .from("forms")
      .update({ title: "pwned" })
      .eq("id", publishedFormId);
    await intruder.client.from("forms").delete().eq("id", publishedFormId);
    await intruder.client.from("responses").delete().eq("id", responseId);
    await intruder.client
      .from("workspaces")
      .update({ name: "pwned" })
      .eq("id", victim.workspaceId);

    const { data: form } = await admin
      .from("forms")
      .select("title")
      .eq("id", publishedFormId)
      .single();
    expect(form?.title).toBe(`Victim published`);
    const { data: response } = await admin
      .from("responses")
      .select("id")
      .eq("id", responseId);
    expect(response).toHaveLength(1);
    const { data: workspace } = await admin
      .from("workspaces")
      .select("name")
      .eq("id", victim.workspaceId)
      .single();
    expect(workspace?.name).toBe("victim workspace");
  });

  it("cannot point a Sheets connection at the victim's form", async () => {
    // Without a form/workspace match, the service-role sync would append
    // the victim's responses to the intruder's spreadsheet.
    const { error } = await intruder.client.from("sheets_connections").insert({
      workspace_id: intruder.workspaceId,
      form_id: draftFormId,
      spreadsheet_id: "intruder-sheet",
      encrypted_tokens: { c: "x" } as Json,
    });
    expect(error).not.toBeNull();
    const { data } = await admin
      .from("sheets_connections")
      .select("id")
      .eq("form_id", draftFormId);
    expect(data).toEqual([]);
  });

  it("cannot publish, or read drop-off for, the victim's form", async () => {
    const publish = await intruder.client.rpc("publish_form_version", {
      target_form_id: draftFormId,
      compiled_schema: schema,
    });
    expect(publish.error).not.toBeNull();
    const { data: versions } = await admin
      .from("form_versions")
      .select("status")
      .eq("form_id", draftFormId);
    expect(versions?.map((v) => v.status)).toEqual(["draft"]);

    const dropoff = await intruder.client.rpc("response_dropoff", {
      target_form_id: publishedFormId,
      idle_minutes: 0,
    });
    expect(dropoff.data ?? []).toEqual([]);
  });

  it("cannot download the victim's uploaded files", async () => {
    const { data, error } = await intruder.client.storage
      .from("response-uploads")
      .download(uploadPath);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("cannot write into the victim's theme-assets folder", async () => {
    const { error } = await intruder.client.storage
      .from("theme-assets")
      .upload(`${victim.workspaceId}/logo-${runId}.png`, new Blob(["x"]), {
        contentType: "image/png",
      });
    expect(error).not.toBeNull();
  });
});

describe("an anonymous visitor", () => {
  const anon = plain();

  it("cannot list forms — including unpublished ones — or their workspaces", async () => {
    const { data } = await anon.from("forms").select("id, workspace_id, title");
    expect(data ?? []).toEqual([]);
  });

  it("cannot read form versions, responses or anything else tenant-owned", async () => {
    for (const table of [
      "form_versions",
      "responses",
      "answers",
      "uploads",
      "webhook_endpoints",
      "sheets_connections",
      "notification_settings",
      "analytics_events",
      "workspaces",
      "workspace_members",
      "profiles",
      "templates",
    ] as const) {
      const { data } = await anon.from(table).select("*").limit(1);
      expect(data ?? [], table).toEqual([]);
    }
  });

  it("cannot call privileged functions", async () => {
    const calls = await Promise.all([
      anon.rpc("publish_form_version", {
        target_form_id: draftFormId,
        compiled_schema: schema,
      }),
      anon.rpc("hit_rate_limit", { p_key: "x", p_limit: 1, p_window_seconds: 1 }),
      anon.rpc("response_dropoff", { target_form_id: publishedFormId, idle_minutes: 0 }),
      anon.rpc("create_workspace_with_owner", {
        workspace_name: "x",
        workspace_slug: "x",
      }),
    ]);
    for (const call of calls) expect(call.error).not.toBeNull();
  });
});

describe("the owner (the supported paths still work)", () => {
  it("reads and edits their own data", async () => {
    const forms = await victim.client.from("forms").select("id").eq("id", draftFormId);
    expect(forms.data).toHaveLength(1);
    const update = await victim.client
      .from("form_versions")
      .update({ schema })
      .eq("form_id", draftFormId)
      .eq("status", "draft");
    expect(update.error).toBeNull();
    const responses = await victim.client
      .from("responses")
      .select("id")
      .eq("id", responseId);
    expect(responses.data).toHaveLength(1);
    const members = await victim.client
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", victim.workspaceId);
    expect(members.data).toEqual([{ user_id: victim.userId, role: "owner" }]);
  });

  it("can create a new form in their workspace", async () => {
    const { error } = await victim.client.from("forms").insert({
      workspace_id: victim.workspaceId,
      title: "Another",
      slug: `another-${runId}`,
      created_by: victim.userId,
    });
    expect(error).toBeNull();
  });
});

describe("workspace listing in a shared workspace", () => {
  it("each member sees only their own memberships, with their own role", async () => {
    // Add the intruder as an editor of the victim's workspace (as the
    // owner would), then list workspaces as each of them.
    await admin.from("workspace_members").insert({
      workspace_id: victim.workspaceId,
      user_id: intruder.userId,
      role: "editor",
    });
    try {
      const asVictim = await listWorkspacesForCurrentUser(victim.client);
      expect(asVictim.map((w) => [w.id, w.role])).toEqual([
        [victim.workspaceId, "owner"],
      ]);

      const asIntruder = await listWorkspacesForCurrentUser(intruder.client);
      expect(asIntruder.map((w) => [w.id, w.role]).sort()).toEqual(
        [
          [intruder.workspaceId, "owner"],
          [victim.workspaceId, "editor"],
        ].sort(),
      );
      // The oldest membership — the intruder's own workspace — stays
      // "current", not the one they were just invited to.
      expect(asIntruder[0].id).toBe(intruder.workspaceId);
    } finally {
      await admin
        .from("workspace_members")
        .delete()
        .eq("workspace_id", victim.workspaceId)
        .eq("user_id", intruder.userId);
    }
  });
});
