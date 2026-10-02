import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  removeMember,
  TeamError,
} from "@/domains/workspaces";
import { createFolder, deleteFolder, moveFormToFolder } from "@/domains/forms";

/**
 * Teams and folders (migration 28) against the real database, signed in
 * as each role: what row-level security lets them do, the seat limit,
 * invitations, owner protection, and folders that never take forms
 * with them.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const runId = crypto.randomUUID().slice(0, 8);
const password = `Pw-${crypto.randomUUID()}`;

type Person = { id: string; email: string; client: SupabaseClient<Database> };
const people: Person[] = [];

async function person(label: string): Promise<Person> {
  const email = `team-${label}-${runId}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const p = { id: data.user.id, email, client };
  people.push(p);
  return p;
}

const schema = {
  schemaVersion: 1,
  meta: { title: "Team form" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [{ id: "q1", type: "short_text", order: 0, label: "Q", settings: {} }],
  logic: [],
} as unknown as Json;

let owner: Person;
let adminUser: Person;
let editor: Person;
let viewer: Person;
let outsider: Person;
let workspaceId: string;
let formId: string;
let responseId: string;

async function invite(p: Person, role: "admin" | "editor" | "viewer") {
  const { path } = await createInvitation(admin, {
    workspaceId,
    email: p.email,
    role,
    invitedBy: owner.id,
  });
  return path.split("/").pop()!;
}

beforeAll(async () => {
  owner = await person("owner");
  adminUser = await person("admin");
  editor = await person("editor");
  viewer = await person("viewer");
  outsider = await person("outsider");
  const { data: ws, error } = await owner.client.rpc("create_workspace_with_owner", {
    workspace_name: "Team",
    workspace_slug: `team-${runId}`,
  });
  if (error) throw error;
  workspaceId = ws.id;
  const { data: form } = await owner.client
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Team form",
      slug: `team-${runId}`,
      created_by: owner.id,
    })
    .select("id")
    .single();
  formId = form!.id;
  await owner.client
    .from("form_versions")
    .insert({ form_id: formId, status: "draft", version_number: 1, schema });
  const { error: publishError } = await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: schema,
  });
  if (publishError) throw publishError;
  const { data: version } = await admin
    .from("form_versions")
    .select("id")
    .eq("form_id", formId)
    .eq("status", "published")
    .single();
  const { data: response } = await admin
    .from("responses")
    .insert({ form_id: formId, form_version_id: version!.id })
    .select("id")
    .single();
  responseId = response!.id;
});

afterAll(async () => {
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  for (const p of people) await admin.auth.admin.deleteUser(p.id);
});

describe("invitations", () => {
  it("are limited by the plan's seats", async () => {
    // Free: one member (the owner).
    await expect(invite(editor, "editor")).rejects.toBeInstanceOf(TeamError);
    await admin.from("workspaces").update({ plan_id: "business" }).eq("id", workspaceId);
  });

  it("only work for the invited address", async () => {
    const token = await invite(editor, "editor");
    await expect(
      acceptInvitation(admin, token, { id: outsider.id, email: outsider.email }),
    ).rejects.toThrow(`This invitation is for ${editor.email}`);
    expect(
      await acceptInvitation(admin, token, { id: editor.id, email: editor.email }),
    ).toBe(workspaceId);
    // Used up.
    await expect(
      acceptInvitation(admin, token, { id: editor.id, email: editor.email }),
    ).rejects.toThrow("expired or was already used");
  });

  it("refuse someone already in the workspace", async () => {
    await expect(invite(editor, "viewer")).rejects.toThrow("already in this workspace");
  });

  it("bring in admins and viewers with their roles", async () => {
    await acceptInvitation(admin, await invite(adminUser, "admin"), adminUser);
    await acceptInvitation(admin, await invite(viewer, "viewer"), viewer);
    const { data } = await admin
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", workspaceId);
    const roles = Object.fromEntries((data ?? []).map((m) => [m.user_id, m.role]));
    expect(roles).toMatchObject({
      [owner.id]: "owner",
      [adminUser.id]: "admin",
      [editor.id]: "editor",
      [viewer.id]: "viewer",
    });
  });
});

describe("what each role can do", () => {
  it("viewers read but change nothing", async () => {
    const c = viewer.client;
    expect((await c.from("forms").select("id").eq("id", formId)).data).toHaveLength(1);
    expect(
      (await c.from("responses").select("id").eq("id", responseId)).data,
    ).toHaveLength(1);

    const insert = await c.from("forms").insert({
      workspace_id: workspaceId,
      title: "x",
      slug: `team-v-${runId}`,
      created_by: viewer.id,
    });
    expect(insert.error).not.toBeNull();
    const rename = await c
      .from("forms")
      .update({ title: "Hacked" })
      .eq("id", formId)
      .select("id");
    expect(rename.data ?? []).toHaveLength(0);
    const draft = await c
      .from("form_versions")
      .update({ revision: 99 })
      .eq("form_id", formId)
      .select("id");
    expect(draft.data ?? []).toHaveLength(0);
    const del = await c.from("responses").delete().eq("id", responseId).select("id");
    expect(del.data ?? []).toHaveLength(0);
    const hook = await c.from("webhook_endpoints").insert({
      form_id: formId,
      url: "https://example.com/hook",
      signing_secret: "s".repeat(32),
    });
    expect(hook.error).not.toBeNull();
    await expect(createFolder(c, workspaceId, "Viewer folder")).rejects.toThrow();
    await expect(changeMemberRole(c, workspaceId, editor.id, "viewer")).rejects.toThrow();
  });

  it("editors build but don't manage members", async () => {
    const c = editor.client;
    const rename = await c
      .from("forms")
      .update({ title: "Renamed" })
      .eq("id", formId)
      .select("id");
    expect(rename.data).toHaveLength(1);
    // The same webhook a viewer was refused.
    const hook = await c
      .from("webhook_endpoints")
      .insert({
        form_id: formId,
        url: "https://example.com/hook",
        signing_secret: "s".repeat(32),
      })
      .select("id");
    expect(hook.error).toBeNull();
    expect(hook.data).toHaveLength(1);
    await expect(changeMemberRole(c, workspaceId, viewer.id, "editor")).rejects.toThrow();
    await expect(removeMember(c, workspaceId, viewer.id)).rejects.toThrow();
  });

  it("admins manage members, but never the owner", async () => {
    const c = adminUser.client;
    await changeMemberRole(c, workspaceId, viewer.id, "editor");
    await changeMemberRole(c, workspaceId, viewer.id, "viewer");
    await expect(changeMemberRole(c, workspaceId, owner.id, "viewer")).rejects.toThrow();
    await expect(removeMember(c, workspaceId, owner.id)).rejects.toThrow();
    // Nobody can hand out "owner".
    const promote = await c
      .from("workspace_members")
      .update({ role: "owner" })
      .eq("workspace_id", workspaceId)
      .eq("user_id", editor.id);
    expect(promote.error).not.toBeNull();
  });

  it("outsiders see nothing", async () => {
    expect(
      (await outsider.client.from("forms").select("id").eq("id", formId)).data,
    ).toEqual([]);
    expect(
      (await outsider.client.from("profiles").select("id").eq("id", owner.id)).data,
    ).toEqual([]);
  });

  it("teammates see each other's name and email for the members list", async () => {
    const { data } = await viewer.client
      .from("profiles")
      .select("id, email")
      .in("id", [owner.id, editor.id, outsider.id]);
    expect(new Set((data ?? []).map((p) => p.email))).toEqual(
      new Set([owner.email, editor.email]),
    );
  });
});

describe("folders", () => {
  it("never take their forms with them", async () => {
    const folder = await createFolder(editor.client, workspaceId, "  Client work  ");
    expect(folder.name).toBe("Client work");
    await moveFormToFolder(editor.client, workspaceId, formId, folder.id);
    await deleteFolder(editor.client, workspaceId, folder.id);
    const { data } = await admin
      .from("forms")
      .select("id, folder_id, deleted_at")
      .eq("id", formId)
      .single();
    expect(data).toEqual({ id: formId, folder_id: null, deleted_at: null });
  });

  it("can't hold another workspace's form", async () => {
    const { data: other } = await outsider.client.rpc("create_workspace_with_owner", {
      workspace_name: "Other",
      workspace_slug: `team-other-${runId}`,
    });
    const theirs = await createFolder(outsider.client, other!.id, "Theirs");
    const { error } = await admin
      .from("forms")
      .update({ folder_id: theirs.id })
      .eq("id", formId);
    expect(error?.message).toContain("another workspace");
    await admin.from("workspaces").delete().eq("id", other!.id);
  });
});
