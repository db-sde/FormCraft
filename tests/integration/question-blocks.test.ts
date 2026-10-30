import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { FormSchemaV1 } from "@/domains/forms/schema/v1";
import {
  blockUsage,
  createBlock,
  getBlockVersion,
  publishBlockVersion,
} from "@/domains/blocks/queries";
import { instantiate, parseBlockQuestions } from "@/domains/blocks/content";
import { publishForm, saveDraftSchema } from "@/domains/forms/queries";
import { FormSchemaError } from "@/domains/forms/schema/validate";
import { checkKioskPin, setKioskPin } from "@/domains/forms/kiosk";
import { startResponse } from "@/domains/responses";

/**
 * Phase 1 against the real database (master spec F-09, F-15): who may
 * read and write blocks, version numbers under racing publishes, the
 * lock on a form's copies at save and publish, and kiosk PINs.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin: SupabaseClient<Database> = createClient<Database>(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const runId = crypto.randomUUID().slice(0, 8);

type Person = {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient<Database>;
};
const people: Person[] = [];

async function person(name: string): Promise<Person> {
  const email = `${name}-${runId}@example.com`;
  const password = crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false },
  });
  const { error: signIn } = await client.auth.signInWithPassword({ email, password });
  if (signIn) throw signIn;
  const p = { id: data.user.id, email, password, client };
  people.push(p);
  return p;
}

let owner: Person;
let viewer: Person;
let outsider: Person;
let workspaceId: string;
let formId: string;
let draftId: string;

const blockQuestions = parseBlockQuestions([
  {
    id: "src_name",
    type: "short_text",
    order: 0,
    label: "Full name",
    required: true,
    settings: {},
  },
  {
    id: "src_consent",
    type: "yes_no",
    order: 1,
    label: "Do you agree to the terms?",
    required: true,
    settings: {},
  },
]);

function formSchema(questions: FormSchemaV1["questions"]): FormSchemaV1 {
  return {
    schemaVersion: 1,
    meta: { title: "Blocks" },
    theme: {
      primaryColor: "#0f172a",
      backgroundColor: "#ffffff",
      fontFamily: "inter",
      buttonStyle: "rounded",
    },
    endings: [{ id: "end", title: "Thanks", isDefault: true }],
    questions: questions.map((q, order) => ({ ...q, order })),
    logic: [],
  };
}

beforeAll(async () => {
  owner = await person("blocks-owner");
  viewer = await person("blocks-viewer");
  outsider = await person("blocks-outsider");
  const { data: ws } = await admin
    .from("workspaces")
    .insert({ name: "Blocks", slug: `blocks-${runId}`, owner_id: owner.id })
    .select("id")
    .single();
  workspaceId = ws!.id;
  await admin.from("workspace_members").insert([
    { workspace_id: workspaceId, user_id: owner.id, role: "owner" },
    { workspace_id: workspaceId, user_id: viewer.id, role: "viewer" },
  ]);
  const { data: form } = await admin
    .from("forms")
    .insert({
      workspace_id: workspaceId,
      title: "Blocks",
      slug: `blocks-form-${runId}`,
      created_by: owner.id,
    })
    .select("id")
    .single();
  formId = form!.id;
  const { data: draft } = await admin
    .from("form_versions")
    .insert({
      form_id: formId,
      status: "draft",
      version_number: 1,
      schema: formSchema([
        {
          id: "q1",
          type: "short_text",
          order: 0,
          label: "Hi",
          required: false,
          settings: {},
        },
      ]) as unknown as Json,
    })
    .select("id, revision")
    .single();
  draftId = draft!.id;
}, 60_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", workspaceId);
  for (const p of people) await admin.auth.admin.deleteUser(p.id);
});

async function draftRevision() {
  const { data } = await admin
    .from("form_versions")
    .select("revision")
    .eq("id", draftId)
    .single();
  return data!.revision;
}

describe("block permissions (RLS)", () => {
  it("editors create blocks; viewers can read but not create; outsiders see nothing", async () => {
    const { id } = await createBlock(owner.client, {
      workspaceId,
      name: "Contact basics",
      questions: blockQuestions,
      userId: owner.id,
    });
    expect((await getBlockVersion(viewer.client, id, 1))?.length).toBe(2);
    await expect(
      createBlock(viewer.client, {
        workspaceId,
        name: "Nope",
        questions: blockQuestions,
        userId: viewer.id,
      }),
    ).rejects.toBeTruthy();
    await expect(
      publishBlockVersion(viewer.client, id, blockQuestions),
    ).rejects.toBeTruthy();
    const { data: seen } = await outsider.client
      .from("question_blocks")
      .select("id")
      .eq("id", id);
    expect(seen).toEqual([]);
    // Versions can't be rewritten, even by the block's editors.
    const { data: rewritten } = await owner.client
      .from("question_block_versions")
      .update({ questions: [] as unknown as Json })
      .eq("block_id", id)
      .select("id");
    expect(rewritten ?? []).toEqual([]);
  });

  it("numbers versions in order when two editors publish at once", async () => {
    const { id } = await createBlock(owner.client, {
      workspaceId,
      name: "Racing",
      questions: blockQuestions,
      userId: owner.id,
    });
    const results = await Promise.all([
      publishBlockVersion(owner.client, id, blockQuestions),
      publishBlockVersion(owner.client, id, blockQuestions),
      publishBlockVersion(owner.client, id, blockQuestions),
    ]);
    expect(results.sort()).toEqual([2, 3, 4]);
    const { data } = await admin
      .from("question_blocks")
      .select("current_version")
      .eq("id", id)
      .single();
    expect(data?.current_version).toBe(4);
  });
});

describe("the lock on a form's copies (F-09)", () => {
  it("saves intact copies, refuses edited ones at save and at publish", async () => {
    const { id } = await createBlock(owner.client, {
      workspaceId,
      name: "Locked",
      questions: blockQuestions,
      userId: owner.id,
    });
    const copies = instantiate({ id, version: 1 }, blockQuestions);
    const intact = formSchema(copies);
    const { revision } = await saveDraftSchema(
      owner.client,
      draftId,
      await draftRevision(),
      intact,
    );
    expect(revision).toBeGreaterThan(0);
    expect(
      (await blockUsage(owner.client, workspaceId, id)).map((u) => u.formId),
    ).toEqual([formId]);

    const edited = formSchema([{ ...copies[0], label: "Name please" }, copies[1]]);
    await expect(
      saveDraftSchema(owner.client, draftId, await draftRevision(), edited),
    ).rejects.toMatchObject({ code: "block_locked" });

    // A draft written straight to the table skips saveDraftSchema, so
    // publishing checks again.
    await owner.client
      .from("form_versions")
      .update({ schema: edited as unknown as Json })
      .eq("id", draftId);
    await expect(
      publishForm(owner.client, formId, admin, owner.id),
    ).rejects.toBeInstanceOf(FormSchemaError);

    // Detached copies are the form's own to change.
    const detached = formSchema([
      { ...copies[0], label: "Name please", block: undefined },
      { ...copies[1], block: undefined },
    ]);
    await saveDraftSchema(owner.client, draftId, await draftRevision(), detached);
    const published = await publishForm(owner.client, formId, admin, owner.id);
    expect(published.versionNumber).toBeGreaterThan(0);
  });
});

describe("kiosk mode (F-15)", () => {
  it("checks the exit PIN against a hash, and allows leaving when none is set", async () => {
    expect(await checkKioskPin(admin, formId, "")).toBe(true);
    await setKioskPin(admin, formId, "2468");
    const { data } = await admin
      .from("form_kiosk_secrets")
      .select("pin_hash")
      .eq("form_id", formId)
      .single();
    expect(data?.pin_hash).not.toContain("2468");
    expect(await checkKioskPin(admin, formId, "2468")).toBe(true);
    expect(await checkKioskPin(admin, formId, "1357")).toBe(false);
    const { data: asMember } = await owner.client
      .from("form_kiosk_secrets")
      .select("pin_hash");
    expect(asMember ?? []).toEqual([]);
    await setKioskPin(admin, formId, null);
    expect(await checkKioskPin(admin, formId, "")).toBe(true);
  });

  it("doesn't tie a kiosk response to the device's visitor id", async () => {
    // The start route drops the visitor id for kiosk starts; startResponse
    // then stores none.
    const { data: live } = await admin
      .from("form_versions")
      .select("id")
      .eq("form_id", formId)
      .eq("status", "published")
      .maybeSingle();
    if (!live) {
      await admin.rpc("publish_form_version", {
        target_form_id: formId,
        compiled_schema: formSchema([
          {
            id: "q1",
            type: "short_text",
            order: 0,
            label: "Hi",
            required: false,
            settings: {},
          },
        ]) as unknown as Json,
      });
    }
    const { responseId } = await startResponse(admin, formId, { visitorId: undefined });
    const { data } = await admin
      .from("responses")
      .select("visitor_id")
      .eq("id", responseId)
      .single();
    expect(data?.visitor_id).toBeNull();
  });
});
