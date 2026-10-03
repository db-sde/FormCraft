import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { completeResponse, startResponse } from "@/domains/responses";
import { joinSsoWorkspace } from "@/domains/identity/sso";
import {
  authenticateScim,
  createScimToken,
  createScimUser,
  deleteScimUser,
  ScimError,
  updateScimUser,
} from "@/domains/identity/scim";
import {
  deletePersonData,
  exportPersonData,
  findPersonResponses,
} from "@/domains/responses/privacy";

/** Wave C against the real database: SSO required means required (in
 * RLS, owner exempt), SSO sign-ins join the right workspace, SCIM
 * decides who may join and removes people, and privacy requests find,
 * export and erase one person's responses. */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const runId = crypto.randomUUID().slice(0, 8);
const password = `Pw-${crypto.randomUUID()}`;
const providerId = crypto.randomUUID();
const domain = `corp-${runId}.example`;
const schema = {
  schemaVersion: 1,
  meta: { title: "Signup" },
  theme: {},
  endings: [{ id: "end", title: "Thanks", isDefault: true }],
  questions: [
    { id: "mail", type: "email", order: 0, label: "Email", required: true, settings: {} },
    {
      id: "who",
      type: "contact_info",
      order: 1,
      label: "You",
      settings: { fields: ["name", "email"], requiredFields: [] },
    },
    { id: "note", type: "short_text", order: 2, label: "Note", settings: {} },
  ],
  logic: [],
} as unknown as Json;

type Person = { id: string; email: string; client: SupabaseClient<Database> };
let owner: Person;
let editor: Person;
let newcomer: Person;
let workspaceId: string;
let formId: string;

async function signIn(label: string): Promise<Person> {
  const email = `wc-${label}-${runId}@${domain}`;
  const { data } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  const client = createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  await client.auth.signInWithPassword({ email, password });
  return { id: data.user!.id, email, client };
}

const asSso = (p: Person) => ({
  id: p.id,
  email: p.email,
  app_metadata: { provider: `sso:${providerId}`, providers: [`sso:${providerId}`] },
});
const isMember = async (userId: string) =>
  !!(
    await admin
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle()
  ).data;

beforeAll(async () => {
  owner = await signIn("owner");
  editor = await signIn("editor");
  newcomer = await signIn("new");
  const { data: ws } = await owner.client.rpc("create_workspace_with_owner", {
    workspace_name: "Corp",
    workspace_slug: `corp-${runId}`,
  });
  workspaceId = ws!.id;
  await admin.from("workspaces").update({ plan_id: "enterprise" }).eq("id", workspaceId);
  await admin
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: editor.id, role: "admin" });
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Signup",
      slug: `corp-${runId}`,
      created_by: owner.id,
    })
    .select("id")
    .single();
  formId = form!.id;
  await admin
    .from("form_versions")
    .insert({ form_id: formId, status: "draft", version_number: 1, schema });
  const { error } = await admin.rpc("publish_form_version", {
    target_form_id: formId,
    compiled_schema: schema,
  });
  if (error) throw error;
  await admin
    .from("workspace_sso")
    .insert({ workspace_id: workspaceId, domain, provider_id: providerId });
});

afterAll(async () => {
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  for (const p of [owner, editor, newcomer]) {
    if (!p) continue;
    // Personal workspaces made along the way.
    await admin.from("workspaces").delete().eq("owner_id", p.id);
    await admin.auth.admin.deleteUser(p.id);
  }
});

describe("single sign-on", () => {
  it("recognises an SSO session from its token", async () => {
    const has = async (claims: Json) =>
      (await owner.client.rpc("jwt_has_sso", { claims })).data;
    expect(await has({ amr: [{ method: "password", timestamp: 1 }] })).toBe(false);
    expect(
      await has({
        amr: [
          { method: "sso/saml", timestamp: 1 },
          { method: "totp", timestamp: 2 },
        ],
      }),
    ).toBe(true);
    expect(await has({})).toBe(false);
    expect(await has({ amr: "sso/saml" })).toBe(false);
  });

  it("when required, shuts out password sessions — except the owner's", async () => {
    const sees = async (p: Person) =>
      ((await p.client.from("forms").select("id").eq("id", formId)).data ?? []).length;
    expect(await sees(editor)).toBe(1);

    // An admin may require SSO and pick the role, but not re-point the provider.
    const hijack = await editor.client
      .from("workspace_sso")
      .update({ provider_id: crypto.randomUUID() })
      .eq("workspace_id", workspaceId);
    expect(hijack.error).not.toBeNull();
    const enforce = await editor.client
      .from("workspace_sso")
      .update({ enforced: true, default_role: "editor" })
      .eq("workspace_id", workspaceId)
      .select("enforced");
    expect(enforce.data).toEqual([{ enforced: true }]);

    expect(await sees(editor)).toBe(0);
    expect(
      (await editor.client.from("workspaces").select("id").eq("id", workspaceId)).data,
    ).toEqual([]);
    expect(await sees(owner)).toBe(1);

    await admin
      .from("workspace_sso")
      .update({ enforced: false })
      .eq("workspace_id", workspaceId);
    expect(await sees(editor)).toBe(1);
  });

  it("adds people who sign in through the provider, with the default role", async () => {
    // A password account is never joined, whatever its email domain.
    expect(
      await joinSsoWorkspace(admin, {
        id: newcomer.id,
        email: newcomer.email,
        app_metadata: { provider: "email", providers: ["email"] },
      }),
    ).toBeNull();
    expect(await joinSsoWorkspace(admin, asSso(newcomer))).toEqual({
      workspaceId,
      joined: true,
    });
    const { data } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", newcomer.id)
      .single();
    expect(data?.role).toBe("editor");
    expect(await joinSsoWorkspace(admin, asSso(newcomer))).toEqual({
      workspaceId,
      joined: false,
    });

    // Without the plan, nobody is joined.
    await admin
      .from("workspace_members")
      .delete()
      .eq("user_id", newcomer.id)
      .eq("workspace_id", workspaceId);
    await admin.from("workspaces").update({ plan_id: "business" }).eq("id", workspaceId);
    expect(await joinSsoWorkspace(admin, asSso(newcomer))).toBeNull();
    await admin
      .from("workspaces")
      .update({ plan_id: "enterprise" })
      .eq("id", workspaceId);
  });
});

describe("SCIM", () => {
  it("decides who may join, and removes people who are deactivated", async () => {
    const token = await createScimToken(admin, workspaceId, owner.id);
    expect(await authenticateScim(admin, `Bearer ${token}`)).toBe(workspaceId);
    expect(await authenticateScim(admin, `Bearer ${token}x`)).toBeNull();
    expect(await authenticateScim(admin, token)).toBeNull();
    const { data: stored } = await admin
      .from("scim_tokens")
      .select("token_hash")
      .eq("workspace_id", workspaceId)
      .single();
    expect(stored!.token_hash).not.toContain(token.slice(5));

    // With SCIM on, someone the directory doesn't list can't join.
    expect(await joinSsoWorkspace(admin, asSso(newcomer))).toBeNull();
    const row = await createScimUser(admin, workspaceId, {
      userName: newcomer.email.toUpperCase(),
      displayName: "New Person",
    });
    await expect(
      createScimUser(admin, workspaceId, { userName: newcomer.email }),
    ).rejects.toMatchObject({ status: 409, scimType: "uniqueness" });
    expect((await joinSsoWorkspace(admin, asSso(newcomer)))?.joined).toBe(true);

    // Deactivated in the directory: out of the workspace, and can't rejoin.
    const { removedMembers } = await updateScimUser(admin, workspaceId, row.id, {
      active: false,
    });
    expect(removedMembers).toBe(1);
    expect(await isMember(newcomer.id)).toBe(false);
    expect(await joinSsoWorkspace(admin, asSso(newcomer))).toBeNull();

    // The owner is never removed by the directory.
    const ownerRow = await createScimUser(admin, workspaceId, { userName: owner.email });
    expect((await deleteScimUser(admin, workspaceId, ownerRow.id)).removedMembers).toBe(
      0,
    );
    expect(await isMember(owner.id)).toBe(true);
    await expect(deleteScimUser(admin, workspaceId, ownerRow.id)).rejects.toBeInstanceOf(
      ScimError,
    );

    // A downgrade switches the token off.
    await admin.from("workspaces").update({ plan_id: "business" }).eq("id", workspaceId);
    expect(await authenticateScim(admin, `Bearer ${token}`)).toBeNull();
    await admin
      .from("workspaces")
      .update({ plan_id: "enterprise" })
      .eq("id", workspaceId);

    // Members can't read tokens or the directory; admins get a summary.
    expect(
      (await owner.client.from("scim_tokens").select("workspace_id")).data ?? [],
    ).toEqual([]);
    expect((await owner.client.from("scim_users").select("id")).data ?? []).toEqual([]);
    const { data: status } = await owner.client.rpc("scim_status", {
      p_workspace_id: workspaceId,
    });
    expect(status?.[0].prefix).toBe(token.slice(0, 10));
  });
});

describe("privacy requests", () => {
  it("find, export and erase one person's responses by email", async () => {
    const submit = async (answers: Record<string, unknown>) => {
      const { responseId } = await startResponse(admin, formId);
      await completeResponse(admin, responseId, 1, "note", answers, crypto.randomUUID());
      return responseId;
    };
    const target = `ada-${runId}@example.com`;
    const first = await submit({ mail: target.toUpperCase(), note: "hello" });
    const second = await submit({
      mail: `other-${runId}@example.com`,
      who: { name: "Ada", email: target },
    });
    // An answer that is exactly the address counts, whatever the question
    // type; one that only mentions it doesn't.
    const third = await submit({ mail: `carol-${runId}@example.com`, note: target });
    const unrelated = await submit({
      mail: `bob-${runId}@example.com`,
      note: `ask ${target} about it`,
    });

    const found = await findPersonResponses(owner.client, workspaceId, target);
    expect(found.map((f) => f.responseId).sort()).toEqual([first, second, third].sort());
    expect(found[0].formTitle).toBe("Signup");

    const exported = await exportPersonData(owner.client, workspaceId, target);
    expect(exported.responses).toHaveLength(3);
    expect(exported.responses.flatMap((r) => r.answers.map((a) => a.question))).toContain(
      "Email",
    );

    // Someone who can't see responses finds — and deletes — nothing.
    await admin
      .from("workspace_members")
      .update({ role: "viewer", permissions: { view_responses: false } })
      .eq("workspace_id", workspaceId)
      .eq("user_id", editor.id);
    expect(await findPersonResponses(editor.client, workspaceId, target)).toEqual([]);
    expect(await deletePersonData(editor.client, admin, workspaceId, target)).toEqual({
      found: 0,
      deleted: 0,
    });

    expect(await deletePersonData(owner.client, admin, workspaceId, target)).toEqual({
      found: 3,
      deleted: 3,
    });
    const { data: left } = await admin
      .from("responses")
      .select("id")
      .in("id", [first, second, third, unrelated]);
    expect(left).toEqual([{ id: unrelated }]);
  });
});
