import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { acceptInvitation, createInvitation } from "@/domains/workspaces";
import { parseFormSchema } from "@/domains/forms/schema";
import {
  deleteWorkspaceTemplate,
  duplicateWorkspaceTemplate,
  listWorkspaceTemplates,
  saveFormAsTemplate,
  schemaFromWorkspaceTemplate,
  updateWorkspaceTemplate,
} from "@/domains/templates";

/**
 * Custom templates (F-61, migration 62) against the real database, as
 * each role: who sees a private or shared template, who may change or
 * delete one, and a form made from one sharing no ids with its source.
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
  const email = `tpl-${label}-${runId}@example.com`;
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

const schema = parseFormSchema({
  schemaVersion: 1,
  meta: { title: "Source form" },
  theme: {},
  endings: [
    { id: "end", title: "Thanks {{answer:q_name}}", isDefault: true },
    { id: "vip", title: "Welcome, VIP" },
  ],
  questions: [
    {
      id: "q_name",
      type: "short_text",
      order: 0,
      label: "Name",
      required: true,
      settings: {},
    },
    {
      id: "q_tier",
      type: "single_select",
      order: 1,
      label: "Tier",
      required: true,
      settings: {
        allowOther: false,
        options: [
          { id: "o_basic", label: "Basic" },
          { id: "o_vip", label: "VIP" },
        ],
      },
    },
  ],
  logic: [
    {
      id: "l_vip",
      questionId: "q_tier",
      operator: "equals",
      value: "o_vip",
      action: { type: "jump_to_ending", endingId: "vip" },
    },
  ],
});

let owner: Person;
let editor: Person;
let otherEditor: Person;
let viewer: Person;
let outsider: Person;
let workspaceId: string;
let formId: string;

beforeAll(async () => {
  owner = await person("owner");
  editor = await person("editor");
  otherEditor = await person("editor2");
  viewer = await person("viewer");
  outsider = await person("outsider");
  const { data: ws, error } = await owner.client.rpc("create_workspace_with_owner", {
    workspace_name: "Templates",
    workspace_slug: `tpl-${runId}`,
  });
  if (error) throw error;
  workspaceId = ws.id;
  await admin.from("workspaces").update({ plan_id: "business" }).eq("id", workspaceId);
  for (const [p, role] of [
    [editor, "editor"],
    [otherEditor, "editor"],
    [viewer, "viewer"],
  ] as const) {
    const { path } = await createInvitation(admin, {
      workspaceId,
      email: p.email,
      role,
      invitedBy: owner.id,
    });
    await acceptInvitation(admin, path.split("/").pop()!, { id: p.id, email: p.email });
  }
  const { data: form } = await owner.client
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Source form",
      slug: `tpl-${runId}`,
      created_by: owner.id,
    })
    .select("id")
    .single();
  formId = form!.id;
});

afterAll(async () => {
  if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
  for (const p of people) await admin.auth.admin.deleteUser(p.id);
});

const save = (p: Person, visibility: "private" | "workspace", title: string) =>
  saveFormAsTemplate(p.client, {
    workspaceId,
    userId: p.id,
    schema,
    sourceFormId: formId,
    title,
    visibility,
  });

describe("custom templates (F-61)", () => {
  let shared: string;
  let secret: string;

  it("are saved by editors, never by viewers", async () => {
    shared = (await save(editor, "workspace", "Shared one")).id;
    secret = (await save(editor, "private", "Private one")).id;
    await expect(save(viewer, "workspace", "Nope")).rejects.toThrow(/editors and up/);
  });

  it("show a private one only to its creator; nothing to other workspaces", async () => {
    const titles = async (p: Person) =>
      (await listWorkspaceTemplates(p.client, workspaceId, p.id))
        .map((t) => t.title)
        .sort();
    expect(await titles(editor)).toEqual(["Private one", "Shared one"]);
    expect(await titles(otherEditor)).toEqual(["Shared one"]);
    expect(await titles(viewer)).toEqual(["Shared one"]);
    expect(await titles(outsider)).toEqual([]);
    expect(
      await schemaFromWorkspaceTemplate(otherEditor.client, workspaceId, secret),
    ).toBeNull();
  });

  it("are changed or deleted by their creator or an admin only", async () => {
    expect(
      await updateWorkspaceTemplate(otherEditor.client, workspaceId, shared, {
        title: "Mine",
      }),
    ).toBe(false);
    expect(await deleteWorkspaceTemplate(otherEditor.client, workspaceId, shared)).toBe(
      false,
    );
    expect(
      await updateWorkspaceTemplate(editor.client, workspaceId, shared, {
        title: "Renamed",
      }),
    ).toBe(true);
    // Not even its creator can move it to another workspace or hand it on.
    const moved = await editor.client
      .from("workspace_templates")
      .update({ created_by: otherEditor.id } as never)
      .eq("id", shared);
    expect(moved.error).not.toBeNull();
    expect(await deleteWorkspaceTemplate(owner.client, workspaceId, secret)).toBe(false);
  });

  it("make forms with fresh ids, every reference following them", async () => {
    const made = await schemaFromWorkspaceTemplate(viewer.client, workspaceId, shared);
    expect(made).not.toBeNull();
    const { schema: copy } = made!;
    expect(copy.meta.title).toBe("Renamed");
    const [name, tier] = copy.questions;
    expect(name.id).not.toBe("q_name");
    expect(tier.id).not.toBe("q_tier");
    const options = (tier.settings as { options: { id: string; label: string }[] })
      .options;
    expect(options.map((o) => o.label)).toEqual(["Basic", "VIP"]);
    expect(options[1].id).not.toBe("o_vip");
    const vip = copy.endings.find((e) => e.title === "Welcome, VIP")!;
    expect(vip.id).not.toBe("vip");
    expect(copy.logic[0]).toMatchObject({
      questionId: tier.id,
      value: options[1].id,
      action: { type: "jump_to_ending", endingId: vip.id },
    });
    expect(copy.endings.find((e) => e.isDefault)!.title).toBe(
      `Thanks {{answer:${name.id}}}`,
    );
    // Still a valid form.
    expect(() => parseFormSchema(copy)).not.toThrow();
  });

  it("are copied privately by whoever copies them; a private one can't be copied by others", async () => {
    const copy = await duplicateWorkspaceTemplate(otherEditor.client, {
      workspaceId,
      userId: otherEditor.id,
      templateId: shared,
    });
    expect(copy).not.toBeNull();
    const mine = await listWorkspaceTemplates(
      otherEditor.client,
      workspaceId,
      otherEditor.id,
    );
    expect(mine.find((t) => t.id === copy!.id)).toMatchObject({
      title: "Renamed (copy)",
      visibility: "private",
      mine: true,
    });
    // The editor who made the original doesn't see the private copy.
    const theirs = await listWorkspaceTemplates(editor.client, workspaceId, editor.id);
    expect(theirs.some((t) => t.id === copy!.id)).toBe(false);
    expect(
      await duplicateWorkspaceTemplate(otherEditor.client, {
        workspaceId,
        userId: otherEditor.id,
        templateId: secret,
      }),
    ).toBeNull();
    await expect(
      duplicateWorkspaceTemplate(viewer.client, {
        workspaceId,
        userId: viewer.id,
        templateId: shared,
      }),
    ).rejects.toThrow(/editors and up/);
  });

  it("are deleted by an admin even when someone else made them", async () => {
    expect(await deleteWorkspaceTemplate(owner.client, workspaceId, shared)).toBe(true);
    expect(await deleteWorkspaceTemplate(editor.client, workspaceId, secret)).toBe(true);
  });
});
